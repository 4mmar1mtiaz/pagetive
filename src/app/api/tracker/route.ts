/**
 * The tracker, served as a script rather than bundled into the page.
 *
 * Written as a plain string of ES5-ish JavaScript on purpose: it runs on
 * strangers' browsers on pages whose traffic the owner paid for, so it must not
 * depend on the app's bundle, must not block paint, and must never throw in a
 * way that could break the customer's conversion path. Every listener is
 * passive and every send is fire-and-forget.
 *
 * What it measures maps one-to-one onto what the analytics screen shows:
 *   view          — one per session, the denominator for everything else
 *   scroll        — deepest decile reached, so the drop-off curve is real
 *   dwell         — per block, from IntersectionObserver, the attention signal
 *   click / cta   — coordinates for the heatmap, block id for the section report
 *   form_start    — the gap between this and a conversion is where forms die
 *
 * Conversions are deliberately NOT recorded here. Only the server knows whether
 * a submit succeeded, and a browser-reported conversion would double-count
 * against the one the lead endpoint writes.
 */

const SCRIPT = `(function () {
  var el = document.currentScript;
  if (!el) return;
  var pageId = el.getAttribute("data-page");
  var variantId = el.getAttribute("data-variant") || null;
  if (!pageId) return;

  function cookie(name) {
    var m = document.cookie.match("(^|;)\\\\s*" + name + "\\\\s*=\\\\s*([^;]+)");
    return m ? m.pop() : "";
  }
  function rid() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  var visitorId = cookie("alp_vid") || "anon";
  var sessionId = "";
  try {
    sessionId = sessionStorage.getItem("alp_sid") || "";
    if (!sessionId) { sessionId = rid(); sessionStorage.setItem("alp_sid", sessionId); }
  } catch (e) { sessionId = rid(); }

  var queue = [];
  var timer = null;

  function flush(useBeacon) {
    if (!queue.length) return;
    var payload = JSON.stringify({
      pageId: pageId, variantId: variantId, visitorId: visitorId, sessionId: sessionId, events: queue
    });
    queue = [];
    try {
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon("/api/track", new Blob([payload], { type: "application/json" }));
      } else {
        fetch("/api/track", {
          method: "POST", headers: { "content-type": "application/json" },
          body: payload, keepalive: true
        }).catch(function () {});
      }
    } catch (e) {}
  }

  function push(type, data) {
    var ev = { type: type };
    for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) ev[k] = data[k];
    queue.push(ev);
    if (queue.length >= 25) flush(false);
    else if (!timer) timer = setTimeout(function () { timer = null; flush(false); }, 4000);
  }

  function docHeight() {
    var b = document.body, d = document.documentElement;
    return Math.max(b.scrollHeight, b.offsetHeight, d.clientHeight, d.scrollHeight, d.offsetHeight) || 1;
  }
  function blockOf(node) {
    while (node && node !== document.body) {
      if (node.getAttribute && node.getAttribute("data-block-id")) return node.getAttribute("data-block-id");
      node = node.parentNode;
    }
    return null;
  }

  push("view", { meta: { ref: document.referrer || "", q: location.search || "", w: window.innerWidth } });

  /* ---- scroll depth: report each new decile once ---- */
  var deepest = 0;
  function onScroll() {
    var reached = (window.scrollY + window.innerHeight) / docHeight();
    var bucket = Math.min(100, Math.floor(reached * 10) * 10);
    if (bucket > deepest) { deepest = bucket; push("scroll", { value: bucket }); }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---- per-block attention ---- */
  var since = {};
  var totals = {};
  function accumulate(id) {
    if (since[id]) {
      totals[id] = (totals[id] || 0) + (Date.now() - since[id]);
      since[id] = 0;
    }
  }
  var blocks = document.querySelectorAll("[data-block-id]");
  if (window.IntersectionObserver) {
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var id = e.target.getAttribute("data-block-id");
        if (e.isIntersecting) { if (!since[id]) since[id] = Date.now(); }
        else accumulate(id);
      }
    }, { threshold: 0.4 });
    for (var i = 0; i < blocks.length; i++) io.observe(blocks[i]);
  }
  function reportDwell() {
    for (var id in since) accumulate(id);
    for (var b in totals) {
      if (totals[b] > 300) push("dwell", { blockId: b, value: totals[b] });
    }
    totals = {};
  }

  /* ---- clicks ---- */
  document.addEventListener("click", function (e) {
    var target = e.target;
    var id = blockOf(target);
    var h = docHeight();
    var x = Math.max(0, Math.min(1, e.pageX / (document.documentElement.clientWidth || 1)));
    var y = Math.max(0, Math.min(1, e.pageY / h));
    var cta = null, node = target;
    while (node && node !== document.body) {
      if (node.getAttribute && node.getAttribute("data-cta")) { cta = node.getAttribute("data-cta"); break; }
      if (node.tagName === "A" || node.tagName === "BUTTON") { cta = node.tagName.toLowerCase(); break; }
      node = node.parentNode;
    }
    var label = (target.innerText || "").slice(0, 60);
    push(cta ? "cta" : "click", { blockId: id, x: x, y: y, meta: { label: label, cta: cta } });
  }, { passive: true, capture: true });

  /* ---- form lifecycle, dispatched by the form component ---- */
  window.addEventListener("alp:form_start", function (e) {
    push("form_start", { blockId: (e.detail && e.detail.blockId) || null });
  });
  /* The conversion itself is recorded server-side by the lead endpoint, which
     is the only place that knows the submit actually succeeded. This listener
     exists to push the session's pending events before the redirect. */
  window.addEventListener("alp:conversion", function () { reportDwell(); flush(true); });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { reportDwell(); flush(true); }
  });
  window.addEventListener("pagehide", function () { reportDwell(); flush(true); });
})();`;

export async function GET() {
  return new Response(SCRIPT, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
