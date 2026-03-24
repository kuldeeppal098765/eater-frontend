/**
 * Calls your backend to start a Paytm payment, loads Paytm’s checkout script, then opens their payment window.
 * Matches Paytm’s documented flow: script → CheckoutJS.onLoad → init → invoke.
 * (Server-side initiate uses JSON `body` + `head.signature` via Axios — see eater-backend `paytmPayment.js`.)
 */

/** Keep in sync with backend `paytmPayment.js` (staging vs production gateway). */
function paytmScriptHost(environment) {
  const e = String(environment || "sandbox").toLowerCase();
  if (e === "production" || e === "prod") {
    return "https://securegw.paytm.in";
  }
  /** Test / sandbox checkout JS — same host as initiateTransaction staging base */
  return "https://securegw-stage.paytm.in";
}

function paytmMerchantScriptUrl(mid, environment) {
  const host = paytmScriptHost(environment);
  return `${host}/merchantpgpui/checkoutjs/merchants/${encodeURIComponent(mid)}.js`;
}

/**
 * Load Paytm’s JS once per merchant id (staging vs production uses the same mid from your account).
 */
function loadPaytmMerchantScript(mid, environment) {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("This must run in a browser."));
      return;
    }
    if (window.Paytm?.CheckoutJS) {
      resolve();
      return;
    }
    const scriptId = `paytm-checkoutjs-${mid}`;
    let el = document.getElementById(scriptId);
    if (el) {
      if (window.Paytm?.CheckoutJS) {
        resolve();
        return;
      }
      el.addEventListener("load", () => resolve(), { once: true });
      el.addEventListener("error", () => reject(new Error("Paytm script failed to load. Check your MID and network.")), {
        once: true,
      });
      return;
    }
    el = document.createElement("script");
    el.id = scriptId;
    el.type = "application/javascript";
    el.crossOrigin = "anonymous";
    el.src = paytmMerchantScriptUrl(mid, environment);
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("Paytm script failed to load. Check your MID and network."));
    document.head.appendChild(el);
  });
}

/**
 * Ask your API for a token, then open Paytm’s payment UI.
 *
 * @param {object} options
 * @param {string} options.apiUrl - Same base as API_URL (must end with /api)
 * @param {string} options.orderId - Your Order.id from the database (UUID)
 * @param {string} options.userId - Logged-in customer user id (must match the order owner)
 * @param {function(string, object): void} [options.onNotify] - Paytm calls this with event names while the user pays
 */
export async function initiatePaytmAndOpenCheckout({ apiUrl, orderId, userId, onNotify }) {
  const base = String(apiUrl || "").replace(/\/$/, "");
  const res = await fetch(`${base}/payment/paytm-initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, userId }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = typeof json.error === "string" ? json.error : `Could not start Paytm (${res.status})`;
    if (json.resultCode != null && json.resultCode !== "") msg = `${msg} (code: ${json.resultCode})`;
    if (typeof json.detail === "string" && json.detail.trim()) msg = `${msg} — ${json.detail.trim().slice(0, 200)}`;
    throw new Error(msg);
  }
  const d = json.data;
  if (!d?.txnToken || !d?.mid || !d?.orderId || d.amount == null) {
    throw new Error("Server response was missing Paytm payment fields.");
  }

  await loadPaytmMerchantScript(d.mid, d.environment);

  if (!window.Paytm?.CheckoutJS) {
    throw new Error("Paytm checkout did not become available after loading the script.");
  }

  const config = {
    root: "",
    flow: "DEFAULT",
    data: {
      orderId: d.orderId,
      token: d.txnToken,
      tokenType: "TXN_TOKEN",
      amount: d.amount,
    },
    handler: {
      notifyMerchant(eventName, data) {
        try {
          onNotify?.(eventName, data);
        } catch {
          /* ignore */
        }
      },
    },
  };

  await new Promise((resolve, reject) => {
    try {
      const CS = window.Paytm.CheckoutJS;
      if (!CS || typeof CS.onLoad !== "function") {
        reject(new Error("Paytm CheckoutJS.onLoad is not available yet."));
        return;
      }
      CS.onLoad(() => {
        try {
          if (typeof CS.init !== "function") {
            reject(new Error("Paytm CheckoutJS.init is not a function."));
            return;
          }
          CS.init(config)
            .then(() => {
              if (typeof CS.invoke !== "function") {
                reject(new Error("Paytm CheckoutJS.invoke is not a function."));
                return;
              }
              return CS.invoke();
            })
            .then(resolve)
            .catch(reject);
        } catch (inner) {
          reject(inner);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
