// File chứa các hàm gọi API
const API_BASE = 'http://localhost:5050/api';

// Lưu token vào localStorage
function saveAuth(token, user) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
}

// Lấy token
function getToken() {
    return localStorage.getItem('token');
}

// Lấy user hiện tại
function getCurrentUser() {
    const u = localStorage.getItem('user');
    return u ? JSON.parse(u) : null;
}

// Xóa thông tin đăng nhập
function clearAuth() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
}

// Hàm gọi API chung
async function apiCall(endpoint, options = {}) {
    const config = {
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        },
        ...options
    };

    // Tự động đính token nếu có
    const token = getToken();
    if (token) {
        config.headers['Authorization'] = `Bearer ${token}`;
    }

    // Cache-busting for GET requests
    let url = API_BASE + endpoint;
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET') {
        const separator = url.includes('?') ? '&' : '?';
        url = `${url}${separator}_t=${Date.now()}`;
    }

    const res = await fetch(url, config);
    const contentType = res.headers.get('content-type');
    let data;
    if (contentType && contentType.includes('application/json')) {
        data = await res.json();
    } else {
        const text = await res.text();
        throw new Error(`Lỗi từ máy chủ (${res.status}): ${text.substring(0, 100)}...`);
    }

    if (!res.ok) {
        throw new Error(data.message || 'Lỗi không xác định');
    }
    return data;
}

// Các hàm cụ thể
async function register(payload) {
    return apiCall('/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

async function login(email, password) {
    const data = await apiCall('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
    });
    saveAuth(data.token, data.user);
    return data;
}

async function logout() {
    try {
        await apiCall('/auth/logout', { method: 'POST' });
    } catch (e) {
        // Ignore lỗi, vẫn xóa local
    }
    clearAuth();
    window.location.href = 'login.html';
}

async function fetchMe() {
    return apiCall('/auth/me');
}

async function createConsignmentStep1(payload) {
    return apiCall('/consignments/step-1', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

async function updateConsignmentStep2(submissionId, payload) {
    return apiCall(`/consignments/${submissionId}/step-2`, {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

async function finalizeConsignmentStep3(submissionId, payload) {
    return apiCall(`/consignments/${submissionId}/step-3`, {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

async function getConsignment(submissionId) {
    return apiCall(`/consignments/${submissionId}`);
}

async function listConsignments(params = {}) {
    const query = new URLSearchParams();
    if (params.ownerId) query.set('ownerId', params.ownerId);
    if (params.status) query.set('status', params.status);
    if (params.limit) query.set('limit', params.limit);
    if (params.offset) query.set('offset', params.offset);

    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiCall(`/consignments${suffix}`);
}

async function listOwnerTracking(params = {}) {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.search) query.set('search', params.search);
    if (params.limit) query.set('limit', params.limit);
    if (params.offset) query.set('offset', params.offset);

    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiCall(`/consignments/owner/me/tracking${suffix}`);
}

async function getOwnerTrackingDetail(submissionId) {
    return apiCall(`/consignments/owner/me/tracking/${submissionId}`);
}

// Sale API helpers
async function listSaleAssignments(params = {}) {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.search) query.set('search', params.search);
    if (params.limit) query.set('limit', params.limit);
    if (params.offset) query.set('offset', params.offset);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiCall(`/sale/assignments${suffix}`);
}

async function listSaleAppointments(params = {}) {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.search) query.set('search', params.search);
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    if (params.limit) query.set('limit', params.limit);
    if (params.offset) query.set('offset', params.offset);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiCall(`/sale/appointments${suffix}`);
}

async function createSaleAppointment(payload) {
    return apiCall('/sale/appointments', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

async function updateSaleAppointment(appointmentId, payload) {
    return apiCall(`/sale/appointments/${appointmentId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
    });
}

async function submitSaleSurvey(payload) {
    return apiCall('/sale/surveys', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

async function listSaleSurveys(submissionId) {
    return apiCall(`/sale/surveys/${submissionId}`);
}

async function getSaleContractDraft(submissionId) {
    return apiCall(`/sale/contracts/${submissionId}`);
}

async function createSaleContract(payload) {
    return apiCall('/sale/contracts', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

async function getSaleContractSummary(submissionId) {
    return apiCall(`/sale/contracts/${submissionId}/summary`);
}

async function updateSaleContractType(submissionId, contractType) {
    return apiCall(`/sale/contracts/${submissionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ contractType })
    });
}

async function uploadSaleContractScan(submissionId, payload) {
    return apiCall(`/sale/contracts/${submissionId}/scan`, {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

async function updateSaleDepositTransaction(submissionId, payload) {
    return apiCall(`/sale/contracts/${submissionId}/deposit`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
    });
}

async function getSaleLegalResponse(submissionId) {
    return apiCall(`/sale/contracts/${submissionId}/legal-response`);
}
// Legal review API helpers
async function listLegalApprovals(params = {}) {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.search) query.set('search', params.search);
    if (params.limit) query.set('limit', params.limit);
    if (params.offset) query.set('offset', params.offset);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiCall(`/legal/approvals${suffix}`);
}

async function getLegalApprovalDetail(submissionContractId) {
    return apiCall(`/legal/approvals/${submissionContractId}`);
}

async function updateLegalApproval(submissionContractId, payload) {
    return apiCall(`/legal/approvals/${submissionContractId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
    });
}

// Broker API helpers
async function listBrokerAssignments() {
    return apiCall('/broker/assignments');
}

async function listBrokerAppointments() {
    return apiCall('/broker/appointments');
}

async function getBrokerDashboardStats() {
    return apiCall('/broker/dashboard-stats');
}

async function getBrokerAssignmentDetail(assignmentId) {
    return apiCall(`/broker/assignments/${assignmentId}`);
}

async function getBrokerAppointmentsForAssignment(assignmentId) {
    return apiCall(`/broker/assignments/${assignmentId}/appointments`);
}

async function createBrokerContract(payload) {
    return apiCall('/broker/contracts', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

async function createBrokerAppointment(payload) {
    return apiCall('/appointments/viewings', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

// Admin API helpers
async function getAdminAssignments(params = {}) {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.property_type) query.set('property_type', params.property_type);
    if (params.limit) query.set('limit', params.limit);
    if (params.offset) query.set('offset', params.offset);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiCall(`/admin/assignments${suffix}`);
}

async function getAdminSalesAgents() {
    return apiCall('/admin/sales-agents');
}

async function assignSurveyor(submissionId, assignedSalesId) {
    return apiCall(`/admin/assignments/${submissionId}`, {
        method: 'POST',
        body: JSON.stringify({ assignedSalesId })
    });
}

async function getAdminBrokerAssignments(params = {}) {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.limit) query.set('limit', params.limit);
    if (params.offset) query.set('offset', params.offset);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiCall(`/admin/broker-assignments${suffix}`);
}

async function getAdminBrokers() {
    return apiCall('/admin/brokers');
}

async function assignAdminBroker(assignmentId, assignedBrokerId) {
    return apiCall(`/admin/broker-assignments/${assignmentId}`, {
        method: 'POST',
        body: JSON.stringify({ assignedBrokerId })
    });
}

// Bảo vệ trang (gọi ở đầu mỗi trang cần đăng nhập)
async function requireLogin() {
    if (!getToken()) {
        window.location.href = 'login.html';
        return null;
    }
    try {
        const data = await fetchMe();
        return data.user;
    } catch (e) {
        clearAuth();
        window.location.href = 'login.html';
        return null;
    }
}