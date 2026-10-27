"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowUpRight, Check, ChevronRight, CircleHelp, Download, Headphones, LoaderCircle, Mic2, Play, Plus, RefreshCw, ShieldCheck, Sparkles, Upload, X } from "lucide-react";
import { signIn, signUp, useSession } from "@/lib/auth-client";
import { RAP_PRODUCT } from "@/lib/rap/config";
import { readRapDraft, writeRapDraft, clearRapDraft, type RapDraft } from "./draft";
import s from "./rap.module.css";
import { trackRap } from "./metrics";

type Generation = { id: string; status: string; error: string | null; createdAt: string; resultExpiresAt: string | null };
type Order = { id: string; status: string; amountCents: number; retryCredits: number; createdAt: string; generations: Generation[] };
const price = `$${(RAP_PRODUCT.priceCents / 100).toFixed(2)}`;
const errorMessages: Record<string, string> = {
  CHECKOUT_NOT_OPEN: "Checkout is not open yet. You can prepare your photos and listen to the track.",
  PHOTOS_EXPIRED: "Your saved photos have expired. Please select them again.",
  SIGN_IN_REQUIRED: "Please sign in to continue. Your photos are saved in this browser.",
  PHOTO_INVALID: "Choose a readable JPG, PNG or WebP, at least 300 × 300 pixels, with a portrait-friendly shape.",
  PHOTO_SIZE_INVALID: "Each photo must be 10 MB or smaller.",
  GENERATION_DISABLED: "Video generation is currently paused. No new task has been submitted.",
  TASK_ALREADY_ACTIVE: "This order already has a task in progress. Check My videos.",
  NO_REPLACEMENT_AVAILABLE: "There is no unused replacement for this order.",
  ORDER_REQUIRES_REVIEW: "This order needs a support check. Please use the feedback form.",
  SERVICE_UNAVAILABLE: "We could not reach the service. Your photos are still here. Please try again.",
  REQUEST_CONFLICT: "This saved checkout belongs to different photos. Re-select your photos to start a new checkout.",
};
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { credentials: "include", cache: "no-store", ...(body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }) });
  const data = await response.json();
  if (!response.ok) throw new Error(errorMessages[data.error] || "Something went wrong. Please try again or contact support with your order number.");
  return data;
}

function PhotoSlot({ side, file, onChange }: { side: "left" | "right"; file?: File; onChange: (file?: File) => void }) {
  const url = useMemo(() => file ? URL.createObjectURL(file) : null, [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return <div className={s.photoSlot}>
    <div className={s.slotLabel}><span>{side === "left" ? "01" : "02"}</span>{side === "left" ? "YOU · LEAD VOCAL" : "YOUR FRIEND · HYPE"}</div>
    <label className={`${s.photoDrop} ${file ? s.hasPhoto : ""}`}>
      {url ? <Image src={url} alt={`${side} person preview`} fill unoptimized sizes="200px" /> : <><span className={s.uploadIcon}><Plus size={25} strokeWidth={1.5} /></span><strong>Add {side === "left" ? "your" : "their"} photo</strong><small>JPG, PNG or WebP</small></>}
      <input aria-label={`${side === "left" ? "Your" : "Your friend's"} photo`} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { const next = e.target.files?.[0]; if (next) onChange(next); e.target.value = ""; }} />
      {file && <span className={s.replace}><Upload size={12} /> Replace photo</span>}
    </label>
    {file && <button className={s.remove} aria-label={`Remove ${side} photo`} onClick={() => onChange(undefined)}><X size={12} /> Remove</button>}
  </div>;
}

export function RapLanding({ googleEnabled = false, initialCheckoutAvailable = false }: { googleEnabled?: boolean; initialCheckoutAvailable?: boolean }) {
  const session = useSession(); const signedIn = Boolean(session.data?.user);
  const [draft, setDraft] = useState<RapDraft | null>(null);
  const [checkoutAvailable, setCheckoutAvailable] = useState(initialCheckoutAvailable);
  const [support, setSupport] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [notice, setNotice] = useState(""); const [authOpen, setAuthOpen] = useState(false);
  const [signup, setSignup] = useState(false); const [authBusy, setAuthBusy] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]); const [showOrders, setShowOrders] = useState(false);
  const [retryOrder, setRetryOrder] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null); const [feedbackSent, setFeedbackSent] = useState(false);
  const authDialog = useRef<HTMLDialogElement>(null); const feedbackDialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false); const audioRef = useRef<HTMLAudioElement>(null); const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let alive = true;
    trackRap("visit");
    readRapDraft().then(saved => { if (alive) setDraft(saved || { requestId: crypto.randomUUID(), savedAt: Date.now() }); })
      .catch(() => { if (alive) { setDraft({ requestId: crypto.randomUUID(), savedAt: Date.now() }); setNotice("Browser storage is unavailable. Keep this tab open while signing in."); } });
    api<{ checkoutAvailable: boolean; supportEmail: string | null }>("/api/rap/config").then(config => { if (alive) { setCheckoutAvailable(config.checkoutAvailable); setSupport(config.supportEmail); } }).catch(() => {});
    if (new URLSearchParams(window.location.search).has("cancelled")) setNotice("Payment was cancelled. Your photos are still here; no new generation was started by this return page.");
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (authOpen) authDialog.current?.showModal(); else authDialog.current?.close(); }, [authOpen]);
  useEffect(() => { if (feedback) feedbackDialog.current?.showModal(); else feedbackDialog.current?.close(); }, [feedback]);
  const loadOrders = useCallback(async () => {
    if (!signedIn) return;
    try { const result = await api<{ orders: Order[] }>("/api/rap/orders"); setOrders(result.orders); }
    catch (e) { setError((e as Error).message); }
  }, [signedIn]);
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    const init = async () => {
      const query = new URLSearchParams(window.location.search); const id = query.get("order");
      if (id && /^rap_[a-f0-9-]{36}$/.test(id)) {
        setShowOrders(true);
        if (!query.has("cancelled")) { try { await api(`/api/rap/orders/${id}`, { action: "sync" }); } catch (e) { if (alive) setNotice((e as Error).message); } }
      }
      if (alive) await loadOrders();
    }; void init(); return () => { alive = false; };
  }, [signedIn, loadOrders]);
  useEffect(() => {
    if (!showOrders || !signedIn) return;
    const pending = orders.some(o => o.status === "created" || o.generations.some(g => !["succeeded", "failed", "expired"].includes(g.status)));
    if (!pending) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void loadOrders(); }, 10_000);
    return () => clearInterval(timer);
  }, [showOrders, signedIn, orders, loadOrders]);

  async function persist(next: RapDraft) {
    setDraft(next);
    try { await writeRapDraft(next); } catch { setNotice("Your browser could not save the photos. Keep this tab open until checkout."); }
  }
  async function choose(side: "left" | "right", file?: File) {
    setError("");
    if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > RAP_PRODUCT.maxImageBytes)) {
      setError("Use a JPG, PNG or WebP photo, 10 MB or smaller."); return;
    }
    await persist({ ...draft, [side]: file, leftAssetId: undefined, rightAssetId: undefined, requestId: crypto.randomUUID(), savedAt: Date.now() });
  }
  async function loadSamplePhotos() {
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try {
      const [left, right] = await Promise.all([fetch("/rap/sample-left.png").then(r => r.blob()), fetch("/rap/sample-right.png").then(r => r.blob())]);
      await persist({ left: new File([left], "sample-left.png", { type: "image/png" }), right: new File([right], "sample-right.png", { type: "image/png" }), requestId: crypto.randomUUID(), savedAt: Date.now() });
      setNotice("Sample photos loaded. No video is generated by selecting them.");
    } catch { setError("Could not load the sample photos."); } finally { lock.current = false; setBusy(false); }
  }
  async function upload(file: File) {
    const form = new FormData(); form.set("file", file);
    const response = await fetch("/api/rap/assets", { method: "POST", credentials: "include", body: form });
    const data = await response.json(); if (!response.ok) throw new Error(errorMessages[data.error] || "Photo upload failed. Please try again.");
    return data.assetId as string;
  }
  async function checkout() {
    if (!draft?.left || !draft.right) { setError("Add both photos first: you on the left, your friend on the right."); return; }
    trackRap("photos_selected");
    if (!signedIn) { await persist(draft); setError(""); trackRap("sign_in_opened"); setAuthOpen(true); return; }
    if (!checkoutAvailable) { setError(errorMessages.CHECKOUT_NOT_OPEN); return; }
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    trackRap("checkout_clicked");
    try {
      const next = { ...draft };
      if (!next.leftAssetId) { next.leftAssetId = await upload(next.left!); await persist(next); }
      if (!next.rightAssetId) { next.rightAssetId = await upload(next.right!); await persist(next); }
      if (retryOrder) {
        await api(`/api/rap/orders/${retryOrder}`, { action: "retry", requestId: next.requestId, leftAssetId: next.leftAssetId, rightAssetId: next.rightAssetId });
        setRetryOrder(null); setShowOrders(true); setNotice("Your replacement is queued. You can leave this page.");
        await clearRapDraft(); setDraft({ requestId: crypto.randomUUID(), savedAt: Date.now() }); await loadOrders();
      } else {
        const result = await api<{ url: string }>("/api/rap/orders", { requestId: next.requestId, leftAssetId: next.leftAssetId,
          rightAssetId: next.rightAssetId, priceCents: RAP_PRODUCT.priceCents, productKey: RAP_PRODUCT.key });
        window.location.assign(result.url);
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); lock.current = false; }
  }
  async function authSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAuthBusy(true); setError("");
    const values = new FormData(event.currentTarget);
    try {
      const credentials = { email: String(values.get("email")), password: String(values.get("password")) };
      const result = signup ? await signUp.email({ ...credentials, name: String(values.get("name")) }) : await signIn.email(credentials);
      if (result.error) throw new Error(result.error.message || "Could not sign in.");
      setAuthOpen(false); setNotice("You're signed in. Review your photos and click Pay & generate when ready.");
      await session.refetch();
    } catch (e) { setError((e as Error).message); } finally { setAuthBusy(false); }
  }
  async function submitFeedback(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!feedback) return; setBusy(true); setError("");
    const values = new FormData(event.currentTarget);
    try { await api(`/api/rap/orders/${feedback}/feedback`, { message: values.get("message"), request: values.get("request") }); setFeedbackSent(true); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function toggleAudio() {
    if (!audioRef.current) return;
    if (playing) audioRef.current.pause(); else { try { await audioRef.current.play(); } catch { setNotice("Audio could not play. Please try the audio controls below."); } }
  }

  return <div className={s.page}>
    <header className={s.header}><Link href="/rap" className={s.logo} aria-label="BOOTH home"><span className={s.logoMark}><Mic2 size={18} /></span>BOOTH<span className={s.logoDot}>®</span></Link>
      <nav aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#the-track">The track</a><a href="#faq">FAQs</a></nav>
      <button className={s.accountButton} onClick={() => { if (signedIn) { setShowOrders(v => !v); void loadOrders(); } else setAuthOpen(true); }}>{signedIn ? "My videos" : "Sign in"}<ArrowUpRight size={14} /></button>
    </header>
    <main>
      <section className={s.hero}>
        <div className={s.heroCopy}><div className={s.eyebrow}><span /> YOUR CAMERA ROLL HAS A NEW SIDE HUSTLE</div>
          <h1>TWO PHOTOS.<br />ONE <span>RAP</span><br /><span className={s.outline}>MOMENT.</span><span className={s.star}>✳</span></h1>
          <p>You. Your best friend. A mic between you.<br />Turn two photos into an 8-second rap moment worth sending to the group chat.</p>
          <a className={s.heroCta} href="#create">Put us in the booth <ArrowDown size={17} /></a>
          <div className={s.heroNotes}><span><Check size={13} /> No filming</span><span><Check size={13} /> No singing</span><span><Check size={13} /> Just your photos</span></div>
          <div className={s.miniNote}>THE ORANGE BOOTH · VOL. 01 <span>ONE TRACK. YOUR DUO.</span></div>
        </div>
        <div className={s.posterArea}><div className={s.posterSticker}>YOUR DUO.<br />MAIN CHARACTER<br />ENERGY. ↗</div>
          <div className={s.poster}><Image src="/rap/booth-concept-v1.webp" alt="Concept art: two people in an orange recording booth with a microphone" fill priority sizes="(max-width: 700px) 85vw, 420px" />
            <div className={s.posterTop}><span><span className={s.recDot} /> BOOTH SESSIONS</span><span>VOL. 001</span></div>
            <div className={s.posterBottom}><span className={s.conceptLabel}>CONCEPT ART · NOT A GENERATED VIDEO</span><strong>BETTER<br />TOGETHER.</strong><div className={s.posterSpecs}><span>8 SEC</span><span>9:16</span><span>720P</span></div></div>
          </div><div className={s.posterCaption}><span>01 / THE ORANGE BOOTH</span><span>← YOUR NEXT GROUP CHAT DROP</span></div>
        </div>
      </section>
      <div className={s.ticker} aria-hidden="true"><span>TWO FACES</span>✳<span>ONE BEAT</span>✳<span>ZERO STAGE FRIGHT</span>✳<span>ALL YOU</span>✳<span>TWO FACES</span>✳<span>ONE BEAT</span></div>
      <section id="create" className={s.createSection}>
        <div className={s.sectionIntro}><span className={s.kicker}>01 — MAKE AN ENTRANCE</span><h2>THE BOOTH<br />IS YOURS.</h2><p>One takes the mic. One brings the hype.<br />Pick your people. We handle the performance.</p>
          <div className={s.formatCard}><Mic2 size={24} /><div><strong>The Orange Booth</strong><span>Original beat · Left lead, right hype</span></div><span className={s.selectedBadge}><Check size={14} /> SELECTED</span></div>
          <div className={s.specRow}><span>8-second video</span><span>Vertical 9:16</span><span>720p MP4</span></div>
          <p className={s.honestNote}><CircleHelp size={15} /> AI performances can vary. Faces and lip sync may not be exact. The illustration above is concept art; a verified video sample is coming.</p>
        </div>
        <div className={s.creator}><div className={s.creatorHeading}><strong>BUILD YOUR DUO</strong><span>STEP 1 OF 1</span></div>
          <div className={s.photoGrid}><PhotoSlot side="left" file={draft?.left} onChange={f => void choose("left", f)} /><span className={s.photoPlus}>+</span><PhotoSlot side="right" file={draft?.right} onChange={f => void choose("right", f)} /></div>
          <div className={s.photoHelp}>Clear, front-facing photos work best. One adult per photo. At least 300 × 300 px; up to 10 MB each. Use photos you have permission to use.</div>
          <button className={s.sampleButton} disabled={busy || !draft} onClick={() => void loadSamplePhotos()}><Sparkles size={14} /> Just exploring? Try the sample photos <ChevronRight size={14} /></button>
          <div className={s.checkoutSummary}><div><strong>{retryOrder ? "Your replacement" : "One duo. One video."}</strong><span>{retryOrder ? "Uses your returned generation opportunity" : "One-time payment. No subscription."}</span></div><strong className={s.price}>{retryOrder ? "$0" : price}<small>USD</small></strong></div>
          {retryOrder && <button className={s.textButton} onClick={() => setRetryOrder(null)}>Cancel replacement selection</button>}
          <button className={s.payButton} disabled={busy || !draft} onClick={() => void checkout()}>{busy ? <LoaderCircle className={s.spin} size={18} /> : <Mic2 size={18} />}{busy ? "Preparing your checkout…" : retryOrder ? "Use replacement & generate" : signedIn ? `Pay ${price} & generate` : "Continue with your photos"}<ArrowUpRight size={19} /></button>
          {!checkoutAvailable && <div className={s.previewNotice}>PREVIEW MODE — Payments and video generation are paused. No video API is called.</div>}
          <div className={s.secureLine}><ShieldCheck size={13} /> PayPal checkout · Photos deleted within 24h of task completion · Video kept 7 days</div>
          <p className={s.termsLine}>By purchasing, you accept the <Link href="/rap/policy#terms">terms</Link>, <Link href="/rap/policy#privacy">privacy</Link> and <Link href="/rap/policy#refunds">refund policy</Link>.</p>
          {error && !authOpen && !feedback && <p className={s.error} role="alert">{error}</p>}
          {notice && <p className={s.notice} role="status">{notice}</p>}
        </div>
      </section>
      {signedIn && <section id="my-videos" className={s.ordersSection}><div className={s.ordersHeading}><div><span className={s.kicker}>YOUR SESSIONS</span><h2>MY VIDEOS.</h2></div><button className={s.accountButton} onClick={() => { setShowOrders(v => !v); void loadOrders(); }}>{showOrders ? "Hide" : "View sessions"}<RefreshCw size={14} /></button></div>
        {showOrders && (orders.length ? <div className={s.orderGrid}>{orders.map(order => <article key={order.id} className={s.orderCard}><div className={s.orderTop}><span>SESSION {order.id.slice(-6).toUpperCase()}</span><span>${(order.amountCents / 100).toFixed(2)}</span></div>
          {!order.generations.length && <p>{order.status === "created" ? "Payment not confirmed yet." : "This order needs a support check."}</p>}
          {order.generations.map(task => <div className={s.task} key={task.id}><strong>{statusLabel(task.status)}</strong>
            {task.status === "succeeded" && task.resultExpiresAt && new Date(task.resultExpiresAt) > new Date() && order.status === "paid" ? <><video controls preload="metadata" playsInline src={`/api/rap/generations/${task.id}/media`} /><a className={s.download} href={`/api/rap/generations/${task.id}/media?download=1`}><Download size={15} /> Download MP4</a><small>Download before {new Date(task.resultExpiresAt).toLocaleString("en-US")}</small></> : <p>{task.status === "failed" ? "The task failed. An eligible replacement is shown below." : ["submission_unknown", "requires_review"].includes(task.status) ? "We're checking the original task. Please don't submit another payment. You may request help or a refund below." : task.status === "expired" || task.status === "succeeded" ? "The download window has ended. Your order is still available for support." : "You can leave this page. We'll email you when your video is ready."}</p>}
          </div>)}
          <div className={s.orderActions}>{order.status === "created" && <button className={s.textButton} onClick={async () => { try { await api(`/api/rap/orders/${order.id}`, { action: "sync" }); await loadOrders(); } catch (e) { setError((e as Error).message); } }}>Check payment</button>}
            {order.status === "paid" && order.retryCredits > 0 && <button className={s.textButton} onClick={() => { setRetryOrder(order.id); document.getElementById("create")?.scrollIntoView({ behavior: "smooth" }); }}>Use replacement ({order.retryCredits}) ↗</button>}
            {order.status !== "created" && <button className={s.textButton} onClick={() => { setFeedback(order.id); setFeedbackSent(false); setError(""); }}>Report a problem ↗</button>}</div>
        </article>)}</div> : <p className={s.empty}>No sessions yet. Your paid videos and replacement opportunities will appear here.</p>)}
      </section>}
      <section id="how-it-works" className={s.howSection}><div className={s.sectionTitle}><span className={s.kicker}>02 — NO TALENT REQUIRED</span><h2>FROM CAMERA ROLL<br />TO MIC DROP.</h2></div><div className={s.steps}>
        {[['01', 'PICK YOUR DUO.', 'Two clear photos. You take the left, your friend takes the right.'], ['02', 'MAKE IT OFFICIAL.', `Sign in, review your photos and pay ${price} once with PayPal.`], ['03', 'DROP IT IN THE CHAT.', 'We generate your moment. Get an email, download the MP4, make their day.']].map(([num, title, copy]) => <div key={num} className={s.step}><span>{num}</span><h3>{title}</h3><p>{copy}</p></div>)}
      </div></section>
      <section id="the-track" className={s.trackSection}><div className={s.record} aria-hidden="true"><div><Mic2 size={32} /><span>BOOTH<br />ORIGINALS</span></div></div><div className={s.trackCopy}><span className={s.kicker}>03 — THE SOUND OF YOUR DUO</span><h2>ONE BEAT.<br />ALL THE ENERGY.</h2><p>“Two faces, one beat. Step in, feel the heat.<br />Side by side, we shine. Your crew, your time.”</p>
        <div className={s.player}><button aria-label={playing ? "Pause soundtrack" : "Play soundtrack"} onClick={() => void toggleAudio()}>{playing ? "Ⅱ" : <Play size={17} fill="currentColor" />}</button><div className={`${s.waveform} ${playing ? s.wavePlaying : ""}`} aria-hidden="true">{Array.from({ length: 38 }, (_, i) => <i key={i} style={{ height: `${12 + ((i * 17 + 11) % 27)}px`, animationDelay: `${i * .025}s` }} />)}</div><span>0:08</span></div>
        <audio ref={audioRef} src={RAP_PRODUCT.musicPath} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
        <small><Headphones size={13} /> Original demo beat + synthetic reference vocals. Final soundtrack approval pending.</small>
      </div></section>
      <section id="faq" className={s.faqSection}><div><span className={s.kicker}>04 — BEFORE YOU HIT RECORD</span><h2>GOOD<br />QUESTIONS.</h2></div><div className={s.faqList}>
        {[
          ['Do I need to sing or upload music?', 'No. The fixed BOOTH track comes with the template. Upload two photos; the left person leads and the right person brings the hype.'],
          ['What exactly am I buying?', `One 8-second, vertical 9:16, 720p MP4 for ${price} USD. No subscription, no credit packages. AI faces, motion and lip sync can vary.`],
          ['How long does it take?', 'Timing depends on the queue and provider. You can leave the page; the job continues and we email you when it is ready. After 30 minutes without a final result, it is flagged for support review rather than automatically resubmitted.'],
          ['What if the video fails or I do not like it?', 'A confirmed technical failure returns one generation opportunity. You can change the photos and manually try again. For an unsatisfactory completed video, use Report a problem on your order to request an individual review. Refunds and extra replacements are reviewed by support.'],
          ['What happens to my photos and video?', 'Photos in our system are deleted within 24 hours of task completion. Unpaid drafts expire after 24 hours; unresolved input photos are retained for at most 7 days. Videos are available for 7 days after completion. Provider retention is separate; see our privacy notice.'],
          ['Is the picture above a real generated video?', 'No. It is labeled concept artwork showing the intended template. Video generation and checkout stay paused until the soundtrack, quality checks and payment setup are approved.'],
        ].map(([q, a]) => <details key={q}><summary>{q}<Plus size={17} /></summary><p>{a}</p></details>)}
      </div></section>
      <section className={s.lastCall}><span>THE GROUP CHAT IS WAITING.</span><a href="#create">YOUR TURN.<ArrowUpRight /></a></section>
    </main>
    <footer className={s.footer}><Link href="/rap" className={s.logo}>BOOTH<span className={s.logoDot}>®</span></Link><span>Two faces. One beat. A moment that’s yours.</span><div><Link href="/rap/policy#terms">Terms</Link><Link href="/rap/policy#privacy">Privacy</Link><Link href="/rap/policy#refunds">Refunds</Link>{support ? <a href={`mailto:${support}`}>Contact</a> : <Link href="/rap/policy#support">Support</Link>}</div></footer>
    <dialog ref={authDialog} className={s.dialog} onCancel={() => setAuthOpen(false)} onClose={() => setAuthOpen(false)}><button className={s.close} aria-label="Close sign in" onClick={() => setAuthOpen(false)}><X size={20} /></button><span className={s.kicker}>KEEP YOUR DUO TOGETHER</span><h2>{signup ? "JOIN THE BOOTH." : "WELCOME BACK."}</h2><p>Your photos stay here. Signing in does not charge you or start generation.</p>
      <form onSubmit={e => void authSubmit(e)}>{signup && <label>Your name<input name="name" required maxLength={100} autoComplete="name" /></label>}<label>Email<input name="email" type="email" required autoComplete="email" /></label><label>Password<input name="password" type="password" required minLength={8} autoComplete={signup ? "new-password" : "current-password"} /></label><button className={s.payButton} disabled={authBusy}>{authBusy ? "Please wait…" : signup ? "Create account" : "Sign in"}<ArrowUpRight size={17} /></button></form>
      {googleEnabled && <button className={s.google} onClick={async () => { setAuthBusy(true); try { if (draft) await persist(draft); await signIn.social({ provider: "google", callbackURL: "/rap" }); } catch { setError("Google sign in could not start."); } finally { setAuthBusy(false); } }}>Continue with Google</button>}
      <button className={s.textButton} onClick={() => setSignup(v => !v)}>{signup ? "Already a member? Sign in" : "New here? Create an account"}</button><Link className={s.textButton} href="/forgot-password">Forgot password?</Link>
      <p className={s.termsLine}>By continuing you accept our <Link href="/rap/policy#terms">terms</Link> and <Link href="/rap/policy#privacy">privacy notice</Link>.</p>{error && <p role="alert" className={s.error}>{error}</p>}
    </dialog>
    <dialog ref={feedbackDialog} className={s.dialog} onCancel={() => setFeedback(null)} onClose={() => setFeedback(null)}><button className={s.close} aria-label="Close feedback" onClick={() => setFeedback(null)}><X size={20} /></button><h2>LET’S SORT IT.</h2><p>Order {feedback}</p>{feedbackSent ? <p role="status">Request saved. Support will review your order and reply by email. Submitting a request does not automatically issue a refund or replacement.</p> : <form onSubmit={e => void submitFeedback(e)}><label>What would help?<select name="request"><option value="help">Help with my video</option><option value="replacement">Request a replacement</option><option value="refund">Request a refund</option></select></label><label>Tell us what happened<textarea name="message" required minLength={10} maxLength={2000} rows={4} /></label><button className={s.payButton} disabled={busy}>Send request<ArrowUpRight size={17} /></button>{error && <p role="alert" className={s.error}>{error}</p>}</form>}</dialog>
    <a href="#create" className={s.mobileCta}>Make your duo <ArrowUpRight size={15} /></a>
  </div>;
}

function statusLabel(status: string) {
  return ({ queued: "In the queue", preparing: "Preparing your session", submitting: "Submitting your session", submission_unknown: "Submission under review",
    waiting: "Waiting for the booth", generating: "Recording your moment", persisting: "Saving your video", requires_review: "Support review needed", succeeded: "Your duo is ready", failed: "Generation failed", expired: "Video expired" } as Record<string, string>)[status] || "Checking your session";
}
