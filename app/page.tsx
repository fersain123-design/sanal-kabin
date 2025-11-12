'use client';

// Sanal Kabin V3.5 — FULL page.tsx
// ---------------------------------------------------------------
// Bu dosya, tek başına çalışacak şekilde tasarlanmıştır.
// - Dış bağımlılıkları minimize eder (shadcn yerine inline UI)
// - Arka/ön kamera, fotoğraf yakalama, ürün katmanı, sürükle-büyüt-şeffaflık
// - Dış URL'leri otomatik proxy'ler: /api/proxy?url=...
// - Deep-link parametrelerini okur: ?img=...&name=...&brand=...&type=...
// - 3D-vari arka plan için Canvas animasyonu (ek kütüphane gerekmez)
// - Touch (mobil) + Mouse destekli sürükleme
// - Döndürme (rotation) ve katman Z-sırası
// - Dahili yardımcı testler (console)
// ---------------------------------------------------------------

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ---------------------------------------------------------------
// 0) INLINE UI PRIMITIVES (shadcn-yok modu)
// ---------------------------------------------------------------

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' };
const Button: React.FC<ButtonProps> = ({ className = '', variant = 'primary', ...props }) => {
  const base = 'px-4 py-2 rounded-xl font-semibold transition select-none focus:outline-none focus:ring-2 focus:ring-offset-2';
  const theme =
    variant === 'primary' ? 'bg-blue-600 hover:bg-blue-500 text-white focus:ring-blue-400'
    : variant === 'secondary' ? 'bg-neutral-200 hover:bg-neutral-300 text-neutral-900 focus:ring-neutral-300'
    : variant === 'danger' ? 'bg-red-600 hover:bg-red-500 text-white focus:ring-red-400'
    : 'bg-transparent hover:bg-white/10 text-white focus:ring-white/30 border border-white/20';
  return <button className={`${base} ${theme} ${className}`} {...props} />;
};

const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = '', ...props }) => (
  <div className={`bg-white/10 backdrop-blur-md border border-white/20 shadow-lg rounded-2xl ${className}`} {...props} />
);
const CardBody: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = '', ...props }) => (
  <div className={`p-4 md:p-6 ${className}`} {...props} />
);

const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = ({ className = '', ...props }) => (
  <input className={`w-full px-3 py-2 rounded-lg bg-black/40 border border-white/20 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-400 ${className}`} {...props} />
);

const Range: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = ({ className = '', ...props }) => (
  <input type="range" className={`w-full accent-blue-400 ${className}`} {...props} />
);

const Switch: React.FC<{ checked: boolean; onCheckedChange: (v: boolean) => void; label?: string }>
  = ({ checked, onCheckedChange, label }) => (
  <label className="flex items-center gap-2 cursor-pointer select-none">
    <span className="text-sm opacity-80">{label}</span>
    <span className={`w-11 h-6 rounded-full p-1 transition ${checked ? 'bg-blue-500' : 'bg-white/30'}`}
      onClick={() => onCheckedChange(!checked)}>
      <span className={`block w-4 h-4 bg-white rounded-full transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </span>
  </label>
);

// Inline icon (LinkIcon) — CDN bağı yok
const LinkIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M10 13a5 5 0 0 1 0-7l1.5-1.5a5 5 0 1 1 7 7L17 12"/>
    <path d="M14 11a5 5 0 0 1 0 7L12.5 19.5a5 5 0 1 1-7-7L7 10"/>
  </svg>
);

// Basit ikonlar (Camera/Upload/Layers/ZoomIn muadilleri) — metin ile
const IconText: React.FC<{ text: string }> = ({ text }) => (
  <span className="inline-flex items-center gap-2">{/* ikonu sade bıraktık */}
    <span className="inline-block w-3 h-3 rounded-full bg-current opacity-70" />
    {text}
  </span>
);

// ---------------------------------------------------------------
// 1) YARDIMCILAR
// ---------------------------------------------------------------

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const mapRange = (v: number, inMin: number, inMax: number, outMin: number, outMax: number) => outMin + ((v - inMin) * (outMax - outMin)) / (inMax - inMin || 1);

function normalizeImageUrl(raw: string): string {
  let s = raw.trim();
  try { s = decodeURIComponent(s); } catch {}
  const isExt = /^https?:\/\//i.test(s);
  const isLocal = s.startsWith('/') && !s.startsWith('//');
  if (isExt) return `/api/proxy?url=${encodeURIComponent(s)}`;
  if (isLocal) return s;
  // çıplak domain veya eksik şema
  return `/api/proxy?url=${encodeURIComponent('https://' + s)}`;
}

function useQuery() { return useMemo(() => new URLSearchParams(typeof window !== 'undefined' ? window.location.search : ''), []); }

// ---------------------------------------------------------------
// 2) ARKA PLAN CANVAS ANİMASYONU (3D vari)
// ---------------------------------------------------------------

const BackgroundCanvas: React.FC = () => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    let w = canvas.width = canvas.offsetWidth;
    let h = canvas.height = canvas.offsetHeight;
    const onResize = () => { w = canvas.width = canvas.offsetWidth; h = canvas.height = canvas.offsetHeight; };
    window.addEventListener('resize', onResize);

    const blobs = Array.from({ length: 6 }).map((_, i) => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 80 + Math.random() * 160,
      vx: (Math.random() * 0.6 + 0.2) * (Math.random() < 0.5 ? -1 : 1),
      vy: (Math.random() * 0.6 + 0.2) * (Math.random() < 0.5 ? -1 : 1),
      hue: 200 + i * 20,
    }));

    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      // arka plan gradyan
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#0b1020');
      g.addColorStop(1, '#06070e');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = 'lighter';
      for (const b of blobs) {
        b.x += b.vx; b.y += b.vy;
        if (b.x < -b.r) b.x = w + b.r; else if (b.x > w + b.r) b.x = -b.r;
        if (b.y < -b.r) b.y = h + b.r; else if (b.y > h + b.r) b.y = -b.r;

        const radgrad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        radgrad.addColorStop(0, `hsla(${b.hue}, 100%, 60%, 0.35)`);
        radgrad.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
        ctx.fillStyle = radgrad;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, []);
  return <canvas ref={ref} className="fixed inset-0 -z-10 w-full h-full" />;
};

// ---------------------------------------------------------------
// 3) TİP TANIMLARI
// ---------------------------------------------------------------

type Product = { id: string; brand: string; name: string; type: 'top' | 'bottom' | 'dress' | 'outer' | string; img: string };

type Layer = {
  id: string; product: Product;
  x: number; y: number; scale: number; opacity: number; rotation: number; z: number;
};

// ---------------------------------------------------------------
// 4) ANA BİLEŞEN
// ---------------------------------------------------------------

export default function Page() {
  const q = useQuery();

  // Kamera & arka plan
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [useLive, setUseLive] = useState<boolean>(true);
  const [mirror, setMirror] = useState<boolean>(true);
  const [rearCam, setRearCam] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Katmanlar
  const [items, setItems] = useState<Layer[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Deep-link ürünü
  const linkedProduct: Product | null = useMemo(() => {
    const raw = q.get('img');
    if (!raw) return null;
    let decoded = raw; try { decoded = decodeURIComponent(raw); } catch {}
    const img = normalizeImageUrl(decoded);
    return {
      id: `linked-${Date.now()}`,
      brand: q.get('brand') || 'Linked',
      name: q.get('name') || 'Product',
      type: (q.get('type') as any) || 'top',
      img,
    };
  }, [q]);

  useEffect(() => {
    if (linkedProduct) {
      const l: Layer = {
        id: linkedProduct.id,
        product: linkedProduct,
        x: 30, y: 50, scale: 1, opacity: 0.97, rotation: 0, z: 0,
      };
      setItems([l]); setActiveId(l.id);
    }
  }, [linkedProduct]);

  // Kamera akışı
  useEffect(() => {
    let stream: MediaStream | null = null;
    (async () => {
      if (!useLive) return;
      try {
        const facingMode = rearCam ? 'environment' : 'user';
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: false });
        if (videoRef.current) {
          (videoRef.current as HTMLVideoElement).srcObject = stream;
          await (videoRef.current as HTMLVideoElement).play();
        }
      } catch (e) { console.warn('Camera error', e); }
    })();
    return () => { if (stream) stream.getTracks().forEach(t => t.stop()); };
  }, [useLive, rearCam]);

  // Fotoğraf yükle → arka plan
  const onUploadPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const url = URL.createObjectURL(f);
    setBgImage(url); setUseLive(false);
  };

  // Manuel ürün ekle
  const [manualUrl, setManualUrl] = useState<string>('');
  const [manualName, setManualName] = useState<string>('Ürün');
  const [manualBrand, setManualBrand] = useState<string>('Manual');
  const [manualType, setManualType] = useState<string>('top');

  const addManual = () => {
    if (!manualUrl) return;
    const url = normalizeImageUrl(manualUrl);
    const p: Product = { id: `manual-${Date.now()}`, brand: manualBrand || 'Manual', name: manualName || 'Ürün', type: manualType || 'top', img: url };
    const l: Layer = { id: p.id, product: p, x: 40, y: 80, scale: 1, opacity: 0.95, rotation: 0, z: items.length };
    setItems(prev => [...prev, l]);
    setActiveId(l.id);
  };

  // Sürükleme (mouse + touch)
  const dragRef = useRef<{ id: string | null; sx: number; sy: number; bx: number; by: number } | null>({ id: null, sx: 0, sy: 0, bx: 0, by: 0 });

  const startDrag = (id: string, clientX: number, clientY: number) => {
    const it = items.find(i => i.id === id); if (!it || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    dragRef.current = { id, sx: clientX - rect.left, sy: clientY - rect.top, bx: it.x, by: it.y };
    setActiveId(id);
  };

  const moveDrag = (clientX: number, clientY: number) => {
    const d = dragRef.current; if (!d || !d.id || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const cx = clientX - rect.left, cy = clientY - rect.top;
    setItems(prev => prev.map(it => it.id === d.id ? { ...it, x: d.bx + (cx - d.sx), y: d.by + (cy - d.sy) } : it));
  };

  const endDrag = () => { dragRef.current = { id: null, sx: 0, sy: 0, bx: 0, by: 0 }; };

  const onMouseDown = (id: string) => (e: React.MouseEvent) => startDrag(id, e.clientX, e.clientY);
  const onMouseMove = (e: React.MouseEvent) => moveDrag(e.clientX, e.clientY);
  const onTouchStart = (id: string) => (e: React.TouchEvent) => {
    const t = e.touches[0]; if (!t) return; startDrag(id, t.clientX, t.clientY);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const t = e.touches[0]; if (!t) return; moveDrag(t.clientX, t.clientY);
  };

  // Yakalama (render → PNG indir)
  const captureStage = async () => {
    const stage = stageRef.current; if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d'); if (!ctx) return;

    // Mirror
    if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }

    // Arka plan
    if (useLive && videoRef.current) {
      try { ctx.drawImage(videoRef.current, 0, 0, w, h); } catch {}
    } else if (bgImage) {
      await new Promise<void>((res) => { const im = new Image(); im.crossOrigin='anonymous'; im.onload=()=>{ ctx.drawImage(im, 0, 0, w, h); res(); }; im.src = bgImage; });
    } else {
      const g = ctx.createLinearGradient(0,0,w,h); g.addColorStop(0,'#111'); g.addColorStop(1,'#000'); ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
    }

    // Katmanlar (z sırasına göre)
    const sorted = [...items].sort((a,b)=>a.z-b.z);
    for (const it of sorted) {
      const el = document.getElementById(`img-layer-${it.id}`) as HTMLImageElement | null;
      if (!el) continue;
      ctx.save();
      try {
        ctx.globalAlpha = it.opacity;
        // Rotasyon merkezi: sol-üst → görselin sol-üstünü baz alıyoruz, ileri sürümde merkez yapılabilir
        const drawW = Math.round(300 * it.scale);
        const drawH = Math.round((el.naturalHeight / el.naturalWidth) * drawW);
        ctx.translate(it.x, it.y);
        if (it.rotation !== 0) {
          ctx.translate(drawW/2, drawH/2);
          ctx.rotate((Math.PI/180) * it.rotation);
          ctx.translate(-drawW/2, -drawH/2);
        }
        ctx.drawImage(el, 0, 0, drawW, drawH);
      } catch {}
      ctx.restore();
    }

    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `sanal-kabin-${Date.now()}.png`;
    a.click();
  };

  // Aktif item
  const active = items.find(i => i.id === activeId) || null;

  // Yardımcı: aktif item'i güncelle
  const patchActive = useCallback((fn: (it: Layer) => Layer) => {
    if (!active) return;
    setItems(prev => prev.map(it => it.id === active.id ? fn(it) : it));
  }, [active]);

  // Basit Self Tests
  useEffect(() => {
    try {
      const u = normalizeImageUrl('cdn.example.com/a.png');
      if (!u.startsWith('/api/proxy?url=')) throw new Error('normalize failed 1');
      const u2 = normalizeImageUrl('https://cdn.example.com/a.png');
      if (!u2.startsWith('/api/proxy?url=')) throw new Error('normalize failed 2');
      const arr1 = [{ id: 'a' }], arr2 = arr1.map(x => ({...x}));
      if (arr1 === arr2) throw new Error('immutability fail');
      console.debug('[SelfTest] OK');
    } catch (e) { console.warn('[SelfTest] FAIL', e); }
  }, []);

  return (
    <>
      {/* Arka plan */}
      <BackgroundCanvas />

      {/* Katman: üst sayfa */}
      <div className="min-h-screen text-white relative z-10 p-4 md:p-8">
        <header className="max-w-7xl mx-auto mb-6 flex items-center justify-between gap-4">
          <h1 className="text-2xl md:text-4xl font-black tracking-tight">
            SANAL KABİN <span className="text-blue-300">V3.5</span>
          </h1>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={()=>window.location.href='/'}>Yenile</Button>
            <Button onClick={captureStage}><IconText text="Fotoğraf Çek" /></Button>
          </div>
        </header>

        {/* GRID */}
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* SAHNE */}
          <Card className="lg:col-span-2">
            <CardBody>
              <div className="flex flex-wrap items-center justify-between mb-4 gap-3">
                <div className="text-lg font-semibold">Canlı Deneme Alanı</div>
                <div className="flex items-center gap-4">
                  <Switch label="Ayna" checked={mirror} onCheckedChange={setMirror} />
                  <Switch label="Kamera" checked={useLive} onCheckedChange={setUseLive} />
                  <Switch label="Arka" checked={rearCam} onCheckedChange={setRearCam} />
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onUploadPhoto} />
                  <Button variant="secondary" onClick={()=>fileRef.current?.click()}><IconText text="Fotoğraf Yükle" /></Button>
                </div>
              </div>

              <div
                ref={stageRef}
                onMouseMove={onMouseMove}
                onMouseUp={endDrag}
                onMouseLeave={endDrag}
                onTouchMove={onTouchMove}
                onTouchEnd={endDrag}
                className="relative w-full aspect-[3/4] bg-black overflow-hidden rounded-xl border border-white/10"
                style={{ transform: mirror ? 'scaleX(-1)' : 'none' }}
              >
                {useLive ? (
                  <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
                ) : (
                  <div className="absolute inset-0 w-full h-full bg-center bg-cover"
                       style={{ backgroundImage: bgImage ? `url(${bgImage})` : 'linear-gradient(135deg,#10131a,#0a0c12)' }} />
                )}

                {/* Katman görselleri */}
                {items.sort((a,b)=>a.z-b.z).map((it)=> (
                  <img
                    key={it.id}
                    id={`img-layer-${it.id}`}
                    src={it.product.img}
                    crossOrigin="anonymous"
                    onMouseDown={onMouseDown(it.id)}
                    onTouchStart={onTouchStart(it.id)}
                    className={`absolute cursor-grab select-none ${activeId===it.id ? 'ring-4 ring-blue-500' : ''}`}
                    style={{
                      left: it.x,
                      top: it.y,
                      width: `${Math.round(300*it.scale)}px`,
                      opacity: it.opacity,
                      transform: `${mirror ? 'scaleX(-1)' : ''} rotate(${it.rotation}deg)`,
                      borderRadius: 12,
                      boxShadow: '0 10px 30px rgba(0,0,0,0.35)'
                    }}
                    draggable={false}
                  />
                ))}

                {!useLive && !bgImage && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="bg-black/50 text-white px-4 py-2 rounded-lg text-sm">
                      Canlı kamerayı aç veya fotoğraf yükle.
                    </div>
                  </div>
                )}
              </div>

              {/* Aktif item kontrolleri */}
              {active && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-4">
                  <div className="md:col-span-2">
                    <div className="text-sm font-semibold mb-1">Boyut</div>
                    <Range min={0.3} max={2.5} step={0.01} value={active.scale}
                      onChange={(e)=>patchActive(it=>({...it, scale: Number((e.target as HTMLInputElement).value)}))} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold mb-1">Opaklık</div>
                    <Range min={0.2} max={1} step={0.01} value={active.opacity}
                      onChange={(e)=>patchActive(it=>({...it, opacity: Number((e.target as HTMLInputElement).value)}))} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold mb-1">Döndür</div>
                    <Range min={-45} max={45} step={0.5} value={active.rotation}
                      onChange={(e)=>patchActive(it=>({...it, rotation: Number((e.target as HTMLInputElement).value)}))} />
                  </div>
                  <div className="flex items-end gap-2">
                    <Button variant="secondary" onClick={()=>patchActive(it=>({...it, z: Math.max(0, it.z-1)}))}>Arka</Button>
                    <Button variant="secondary" onClick={()=>patchActive(it=>({...it, z: it.z+1}))}>Ön</Button>
                    <Button variant="danger" onClick={()=>setItems(prev=>prev.filter(x=>x.id!==active.id))}>Kaldır</Button>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* SAĞ PANEL */}
          <Card>
            <CardBody className="space-y-4">
              <div className="text-lg font-semibold flex items-center gap-2">
                <LinkIcon width={18} height={18} /> Ürün Ekle (URL)
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2"><Input placeholder="https://cdn.site.com/product.png" value={manualUrl} onChange={(e)=>setManualUrl(e.target.value)} /></div>
                <Input placeholder="Marka" value={manualBrand} onChange={(e)=>setManualBrand(e.target.value)} />
                <Input placeholder="İsim" value={manualName} onChange={(e)=>setManualName(e.target.value)} />
                <Input placeholder="Tür (top/bottom/dress/outer)" value={manualType} onChange={(e)=>setManualType(e.target.value)} />
                <div className="col-span-2"><Button onClick={addManual}><IconText text="Ekle" /></Button></div>
              </div>

              <div className="pt-4 border-t border-white/20">
                <div className="text-sm font-bold mb-2">Akış (V1)</div>
                <ol className="list-decimal pl-5 text-sm space-y-1 opacity-80">
                  <li>Mağaza sayfasındaki "Dene" linki bu sayfaya <code>?img=...</code> ile yönlendirir.</li>
                  <li>Canlı kamera izin verilirse otomatik açılır.</li>
                  <li>Ürün katmanı üstte görünür; sürükle/boyut/döndür/şeffaflık.</li>
                  <li>Fotoğraf Çek ile kompozisyonu indir.</li>
                </ol>
              </div>

              <div className="pt-4 border-t border-white/20">
                <div className="text-sm font-bold mb-2">V4 Yol Haritası</div>
                <ul className="text-sm space-y-1 opacity-80">
                  <li>• AI Smart Fit: Omuz/baş anahtar noktalarına göre otomatik ölçek/hizalama</li>
                  <li>• Ürün API: Trendyol/Shopify entegrasyonu</li>
                  <li>• 3D/AR Deneme: WebXR/RoomKit araştırması</li>
                  <li>• Paylaşım & QR link akışı</li>
                </ul>
              </div>

              <div className="pt-4 border-t border-white/20">
                <div className="text-xs opacity-70">
                  Derin link örneği:<br/>
                  <code className="break-all">/try?img=https%3A%2F%2Fcdn.example.com%2Fcoat.png&name=Kaban&brand=Demo&type=outer</code>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>

        <footer className="max-w-7xl mx-auto mt-8 text-xs opacity-70">
          © {new Date().getFullYear()} Sanal Kabin — V3.5
        </footer>
      </div>
    </>
  );
}
