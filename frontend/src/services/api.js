const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

let authToken = localStorage.getItem("rentsphere_token") || "";

export function setToken(token) {
  authToken = token;
  if (token) {
    localStorage.setItem("rentsphere_token", token);
  } else {
    localStorage.removeItem("rentsphere_token");
  }
}

export function getToken() {
  return authToken;
}

async function request(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = {
    "Content-Type": "application/json",
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(options.headers || {})
  };

  try {
    const response = await fetch(url, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `HTTP error ${response.status}`);
    }
    return data;
  } catch (err) {
    console.error(`API Error on [${options.method || "GET"} ${endpoint}]:`, err.message);
    throw err;
  }
}

export const api = {
  // Auth
  login: async (email, password) => {
    const data = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    if (data.token) {
      setToken(data.token);
    }
    return data;
  },

  getProfile: () => request("/auth/me"),

  // Agreements
  getAgreements: (companyId = "") => {
    const query = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
    return request(`/agreements${query}`);
  },

  getAgreementById: (id) => request(`/agreements/${encodeURIComponent(id)}`),

  createAgreement: (payload) => request("/agreements", {
    method: "POST",
    body: JSON.stringify(payload)
  }),

  verifyAgreement: (agreementId, providedPdfHash) => request("/verifyAgreement", {
    method: "POST",
    body: JSON.stringify({ agreementId, providedPdfHash })
  }),

  renewAgreement: (agreementId, extensionDurationDays) => request("/renewAgreement", {
    method: "POST",
    body: JSON.stringify({ agreementId, extensionDurationDays })
  }),

  // Payments
  recordPayment: (payload) => request("/payments", {
    method: "POST",
    body: JSON.stringify(payload)
  }),

  // Audit
  getAuditTrail: (limit = 50) => request(`/audit-trail?limit=${limit}`),

  // Stats
  getStats: () => request("/stats"),

  // Tenants
  getTenants: () => request("/tenants")
};

export default api;
