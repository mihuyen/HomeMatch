// File chứa các hàm gọi API
const API_BASE = 'http://localhost:5000/api';

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

    const res = await fetch(API_BASE + endpoint, config);
    const data = await res.json();

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

// Broker API helpers
async function listBrokerAssignments(params = {}) {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.search) query.set('search', params.search);
    if (params.limit) query.set('limit', params.limit);
    if (params.offset) query.set('offset', params.offset);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiCall(`/broker/assignments${suffix}`);
}

async function listBrokerAppointments(params = {}) {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.search) query.set('search', params.search);
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    if (params.limit) query.set('limit', params.limit);
    if (params.offset) query.set('offset', params.offset);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiCall(`/broker/appointments${suffix}`);
}

async function createBrokerAppointment(payload) {
    return apiCall('/broker/appointments', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

async function updateBrokerAppointment(appointmentId, payload) {
    return apiCall(`/broker/appointments/${appointmentId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
    });
}

async function submitBrokerSurvey(payload) {
    return apiCall('/broker/surveys', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

async function listBrokerSurveys(submissionId) {
    return apiCall(`/broker/surveys/${submissionId}`);
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