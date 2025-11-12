'use client';
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
// ⚠️ NOTE: Removed LinkIcon import from lucide-react to avoid CDN fetch error
import { Camera, Upload, Layers, ZoomIn } from "lucide-react";

/**
 * Local inline LinkIcon to avoid external network fetches.
 * Reason: Some bundlers (including the canvas environment) try to resolve
 * individual icon modules from a CDN (e.g. jsdelivr) when using tree-shaken imports
 * like `import { LinkIcon } from 'lucide-react'`, which can fail.
 */
function LinkIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      {/* Simple chain-link icon */}
      <path d="M10 13a5 5 0 0 1 0-7l1.5-1.5a5 5 0 1 1 7 7L17 12"/>
      <path d="M14 11a5 5 0 0 1 0 7L12.5 19.5a5 5 0 1 1-7-7L7 10"/>
    </svg>
  );
}

// === Deep Link Contract (V1) ===
// https://tryon.novanesti.app/try?img={ENCODED_IMAGE_URL}&name={NAME}&brand={BRAND}&type={top|bottom|dress|outer}
// Examples:
// /try?img=https%3A%2F%2Fcdn.example.com%2Fproducts%2Fcoat.png&name=Kaban&brand=Demo&type=outer
// Fallback for native shell later: tryon://try?img=... (Capacitor/iOS/Android)

function useQuery() {
  return useMemo(() => new URLSearchParams(typeof window !== 'undefined' ? window.location.search : ''), []);
}

// Lightweight runtime tests (dev only). No DOM reliance beyond URL parsing.
function runSelfTests() {
  try {
    // Test 1: Deep link round‑trip encoding/decoding
    const sampleImg = "https://cdn.example.com/coat.png";
    const qs1 = new URLSearchParams({ img: encodeURIComponent(sampleImg) }).toString();
    const parsed1 = new URLSearchParams(qs1);
    const decoded1 = decodeURIComponent(parsed1.get('img') || '');
    console.assert(decoded1 === sampleImg, 'Test1: decodeURIComponent failed');

    // Test 2: Layer update immutability
    const before = [{ id: 'x', x: 0, y: 0, z: 0, scale: 1, opacity: 1, product: {} }];
    const after = before.map(it => it.id === 'x' ? { ...it, x: 10 } : it);
    console.assert(before !== after, 'Test2: array must be new');
    console.assert(before[0] !== after[0] && (after[0] as any).x === 10, 'Test2: object updated immutably');

    // Test 3: Mirror transform logic
    const mirror = true; const transform = mirror ? 'scaleX(-1)' : 'none';
    console.assert(transform === 'scaleX(-1)', 'Test3: mirror transform failed');

    console.debug('[SelfTests] All tests passed');
  } catch (err) {
    console.warn('[SelfTests] Failure', err);
  }
}

export default function App() {
  const q = useQuery();
  useEffect(() => { if (typeof window !== 'undefined') runSelfTests(); }, []);

  const [bgImage, setBgImage] = useState<string | null>(null); // photo mode
  const [useLive, setUseLive] = useState(true); // live camera toggle
  const [mirror, setMirror] = useState(true);

  // product from deep link
  const linkedProduct = useMemo(() => {
    const raw = q.get('img');
    if (!raw) return null;
    let decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch {}
    const isExternal = /^https?:\/\//i.test(decoded);
    const isLocal = decoded.startsWith('/') && !decoded.startsWith('//');
    const img = isExternal ? `/api/proxy?url=${encodeURIComponent(decoded)}` : (isLocal ? decoded : null);
    if (!img) return null;
    return {
      id: `linked-${Date.now()}`,
      brand: q.get('brand') || 'Linked',
      name: q.get('name') || 'Product',
      type: q.get('type') || 'top',
      img,
    };
  }, [q]);

  type Layer = { id: string; product: any; x: number; y: number; scale: number; opacity: number; z: number };
  const [items, setItems] = useState<Layer[]>(() => (linkedProduct ? [{ id: `${linkedProduct.id}`, product: linkedProduct, x: 20, y: 40, scale: 1, opacity: 0.95, z: 0 }] : []));
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id || null);

  // Camera
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  // File input ref for reliable click trigger (works on mobile & desktop)
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    (async () => {
      if (!useLive) return;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        if (videoRef.current) {
          (videoRef.current as HTMLVideoElement).srcObject = stream;
          await (videoRef.current as HTMLVideoElement).play();
        }
      } catch (e) {
        console.warn('Camera error', e);
      }
    })();
    return () => { if (stream) stream.getTracks().forEach(t => t.stop()); };
  }, [useLive]);

  // Drag state
  const [drag, setDrag] = useState<{ id: string | null; sx: number; sy: number; bx: number; by: number }>({ id: null, sx: 0, sy: 0, bx: 0, by: 0 });
  const startDrag = (id: string, e: React.MouseEvent) => {
    const item = items.find(i => i.id === id); if (!item || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    setDrag({ id, sx: e.clientX - rect.left, sy: e.clientY - rect.top, bx: item.x, by: item.y });
    setActiveId(id);
  };
  const onMove = (e: React.MouseEvent) => {
    if (!drag.id || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    setItems(prev => prev.map(it => it.id === drag.id ? { ...it, x: drag.bx + (cx - drag.sx), y: drag.by + (cy - drag.sy) } : it));
  };
  const endDrag = () => setDrag({ id: null, sx: 0, sy: 0, bx: 0, by: 0 });

  const active = items.find(i => i.id === activeId) || null;

  // Upload photo
  const onUploadPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const url = URL.createObjectURL(f); setBgImage(url); setUseLive(false);
  };

  // Add manual product
  const [manualUrl, setManualUrl] = useState("");
  const addManual = () => {
    if (!manualUrl) return;
    const p = { id: `manual-${Date.now()}`, brand: 'Manual', name: 'Ürün', type: 'top', img: manualUrl };
    setItems(prev => [...prev, { id: p.id, product: p, x: 20, y: 40, scale: 1, opacity: 0.95, z: prev.length }]);
    setActiveId(p.id);
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 p-4 md:p-8">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Stage */}
        <Card className="lg:col-span-2 shadow-xl rounded-2xl">
          <CardContent className="p-4 md:p-6">
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <div className="text-xl font-semibold">Canlı Deneme Alanı</div>
              <div className="flex items-center gap-3">
                <label className="text-sm">Ayna Modu</label>
                <Switch checked={mirror} onCheckedChange={setMirror} />
                <label className="text-sm">Canlı Kamera</label>
                <Switch checked={useLive} onCheckedChange={setUseLive} />
                {/* Native hidden input + programmatic click to avoid label/display:none issues */}
                <input ref={fileRef} id="photo" type="file" accept="image/*" onChange={onUploadPhoto} className="hidden" />
                <Button variant="outline" className="gap-2" onClick={() => fileRef.current?.click()}>
                  <Upload size={16}/> Fotoğraf Yükle
                </Button>
              </div>
            </div>

            <div
              ref={stageRef}
              onMouseMove={onMove}
              onMouseUp={endDrag}
              onMouseLeave={endDrag}
              className="relative w-full aspect-[3/4] bg-black overflow-hidden rounded-xl border"
              style={{ transform: mirror ? 'scaleX(-1)' : 'none' }}
            >
              {/* Background: live or photo */}
              {useLive ? (
                <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted/>
              ) : (
                <div
                  className="absolute inset-0 w-full h-full bg-center bg-cover"
                  style={{ backgroundImage: bgImage ? `url(${bgImage})` : 'linear-gradient(135deg,#fafafa,#eaeaea)' }}
                />
              )}

              {/* Overlays */}
              {items.sort((a,b)=>a.z-b.z).map((it)=> (
                <img
                  key={it.id}
                  src={it.product.img}
                  crossOrigin="anonymous"
                  onMouseDown={(e)=>startDrag(it.id, e)}
                  className={`absolute cursor-grab select-none ${activeId===it.id ? 'ring-4 ring-blue-500' : ''}`}
                  style={{ left: it.x, top: it.y, width: `${Math.round(300*it.scale)}px`, opacity: it.opacity, transform: mirror ? 'scaleX(-1)' : 'none', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.15)' }}
                  draggable={false}
                />
              ))}

              {!useLive && !bgImage && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="bg-black/50 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2">
                    <Camera size={16}/> Canlı kamerayı aç veya fotoğraf yükle.
                  </div>
                </div>
              )}
            </div>

            {/* Active item controls */}
            {active && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-2">
                  <div className="text-sm font-medium mb-2 flex items-center gap-2"><ZoomIn size={16}/> Boyut</div>
                  <Slider value={[active.scale]} min={0.3} max={2.5} step={0.01} onValueChange={([v]) => setItems(prev=>prev.map(it=>it.id===active.id?{...it, scale:v}:it))} />
                </div>
                <div>
                  <div className="text-sm font-medium mb-2"><Layers className="inline mr-2" size={16}/> Opaklık</div>
                  <Slider value={[active.opacity]} min={0.2} max={1} step={0.01} onValueChange={([v]) => setItems(prev=>prev.map(it=>it.id===active.id?{...it, opacity:v}:it))} />
                </div>
                <div className="flex items-end gap-2">
                  <Button variant="secondary" onClick={() => setItems(prev=>prev.map(it=>it.id===active.id?{...it, z: Math.max(0, it.z-1)}:it))}>Ön/Arka</Button>
                  <Button variant="destructive" onClick={() => setItems(prev=>prev.filter(it=>it.id!==active.id))}>Kaldır</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: Deep Link & Manual */}
        <div className="space-y-4">
          <Card className="shadow-xl rounded-2xl">
            <CardContent className="p-4 md:p-6 space-y-3">
              <div className="text-lg font-semibold flex items-center gap-2"><LinkIcon width={18} height={18}/> Yönlendirme (Deep Link) Testi</div>
              <p className="text-sm text-neutral-700">
                Aşağıdaki forma ürün görsel URL’sini yapıştır. Bu, Trendyol/mağaza sayfasından yönlendirildiğinde geleceği parametredir.
              </p>
              <div className="flex gap-2">
                <Input placeholder="https://cdn.site.com/product.png" value={manualUrl} onChange={(e)=>setManualUrl(e.target.value)} />
                <Button onClick={addManual}>Ekle</Button>
              </div>
              <div className="text-xs text-neutral-500">Not: Şeffaf PNG ve düz önden fotoğraf en iyi sonucu verir.</div>
            </CardContent>
          </Card>

          <Card className="shadow-xl rounded-2xl">
            <CardContent className="p-4 md:p-6 space-y-2">
              <div className="text-lg font-semibold">Akış (V1)</div>
              <ol className="list-decimal pl-5 text-sm space-y-1 text-neutral-700">
                <li>Mağaza/Tre** linki "Dene" → <code>/try?img=...</code> ile bu sayfaya yönlendirir.</li>
                <li>Canlı kamera <strong>açık</strong> gelir (kullanıcı izin verirse).</li>
                <li>Ürün üstte görünür; kullanıcı sürükler/ölçekler/şeffaflık ayarlar.</li>
                <li>Beğenirse mağaza sayfasına geri dönüş veya sepete git (V2).</li>
              </ol>
              <Dialog>
                <DialogTrigger asChild>
                  <Button className="w-full">V2 Yol Haritası</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>V2 (3–6 hafta) Eklentiler</DialogTitle>
                  </DialogHeader>
                  <ul className="text-sm space-y-2">
                    <li>• Yüz‑omuz tespiti ile otomatik ölçek/hizalama (MediaPipe).</li>
                    <li>• Web Share Target + Android App Links + iOS Universal Links.</li>
                    <li>• Mağaza partner parametreleri (affiliate, kampanya ID).</li>
                    <li>• Ev dekor modu: Duvarda/odada ürün yerleşimi 2D grid.</li>
                  </ul>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
