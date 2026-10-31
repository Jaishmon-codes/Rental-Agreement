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

export function clearToken() {
  authToken = "";
  localStorage.removeItem("rentsphere_token");
}

async function request(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = {
    "Content-Type": "application/json",
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(options.headers || {})
  };

  // When body is FormData, browser must set multipart/form-data with boundary
  if (options.body instanceof FormData) {
    delete headers["Content-Type"];
  }

  try {
    const response = await fetch(url, { ...options, headers });
    
    // Handle binary responses (e.g. downloads)
    if (options.responseType === "blob") {
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }
      return await response.blob();
    }

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
  // 1. Authentication & Profile
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

  register: (payload) => request("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload)
  }),

  verifyEmail: (payload) => request("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify(payload)
  }),

  forgotPassword: (email) => request("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email })
  }),

  resetPassword: (payload) => request("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(payload)
  }),

  getProfile: () => request("/auth/me"),

  logout: () => {
    clearToken();
  },

  // 2. Properties & Units
  getProperties: () => request("/properties"),

  getPropertyById: (id) => request(`/properties/${encodeURIComponent(id)}`),

  createProperty: (payload) => request("/properties", {
    method: "POST",
    body: JSON.stringify(payload)
  }),

  deleteProperty: (id) => request(`/properties/${encodeURIComponent(id)}`, {
    method: "DELETE"
  }),

  getPropertyUnits: (propertyId) => request(`/properties/${encodeURIComponent(propertyId)}/units`),

  addUnit: (propertyId, payload) => request(`/properties/${encodeURIComponent(propertyId)}/units`, {
    method: "POST",
    body: JSON.stringify(payload)
  }),

  updateUnit: (propertyId, unitId, payload) => request(`/properties/${encodeURIComponent(propertyId)}/units/${encodeURIComponent(unitId)}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  }),

  // 3. Agreements
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

  // 4. Documents & Storage
  uploadDocument: (formData) => request("/documents/upload", {
    method: "POST",
    body: formData
  }),

  getAgreementDocuments: (agreementId) => request(`/agreements/${encodeURIComponent(agreementId)}/documents`),

  downloadDocument: (documentId) => request(`/documents/${encodeURIComponent(documentId)}/download`, {
    responseType: "blob"
  }),

  // 5. Payments
  recordPayment: (payload) => request("/payments", {
    method: "POST",
    body: JSON.stringify(payload)
  }),

  createPaymentOrder: (agreementId) => request("/payments/create-order", {
    method: "POST",
    body: JSON.stringify({ agreementId })
  }),

  verifyPayment: (payload) => request("/payments/verify", {
    method: "POST",
    body: JSON.stringify(payload)
  }),

  getPayments: (limit = 50, offset = 0) => request(`/payments?limit=${limit}&offset=${offset}`),

  getPaymentById: (id) => request(`/payments/${encodeURIComponent(id)}`),

  refundPayment: (paymentId, payload) => request(`/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: "POST",
    body: JSON.stringify(payload)
  }),

  getFinancialStats: () => request("/payments/stats"),

  getReconciliation: () => request("/payments/reconciliation"),

  registerLandlordAccount: (payload) => request("/landlords/linked-account", {
    method: "POST",
    body: JSON.stringify(payload)
  }),

  // 6. Wallets & Verification
  getWalletNonce: (walletAddress) => request("/wallet/nonce", {
    method: "POST",
    body: JSON.stringify({ walletAddress })
  }),

  verifyWalletSignature: (payload) => request("/wallet/verify", {
    method: "POST",
    body: JSON.stringify(payload)
  }),

  getUserWallets: () => request("/wallet/me"),

  unlinkWallet: (address) => request(`/wallet/${encodeURIComponent(address)}`, {
    method: "DELETE"
  }),

  // 7. Audit & Stats
  getAuditTrail: (limit = 50) => request(`/audit-trail?limit=${limit}`),

  getStats: () => request("/stats"),

  getTenants: () => request("/tenants")
};

export default api;
