// services/api.js
const API_BASE_URL = 'http://localhost:8000/api';

class ApiService {
  constructor() {
    this.token = localStorage.getItem('authToken');
    this.user = JSON.parse(localStorage.getItem('user') || 'null');
    this.isRefreshing = false;
    this.failedQueue = [];
  }

  // Authentication methods
  setToken(token) {
    this.token = token;
    localStorage.setItem('authToken', token);
  }

  setRefreshToken(refreshToken) {
    localStorage.setItem('refreshToken', refreshToken);
  }

  getRefreshToken() {
    return localStorage.getItem('refreshToken');
  }

  setUser(user) {
    this.user = user;
    localStorage.setItem('user', JSON.stringify(user));
  }

  getCurrentUser() {
    return this.user;
  }

  // Clear all auth data
  clearAuth() {
    this.token = null;
    this.user = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
  }

  // Redirect to login
  redirectToLogin() {
    this.clearAuth();
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }

  // Token refresh method
  async refreshToken() {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await fetch(`${API_BASE_URL}/auth/token/refresh/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh: refreshToken }),
      });

      if (!response.ok) {
        throw new Error('Token refresh failed');
      }

      const data = await response.json();
      this.setToken(data.access);
      return data.access;
    } catch (error) {
      this.redirectToLogin();
      throw new Error('Session expired. Please login again.');
    }
  }

  // Process queue of failed requests
  processQueue(error, token = null) {
    this.failedQueue.forEach(promise => {
      if (error) {
        promise.reject(error);
      } else {
        promise.resolve(token);
      }
    });
    this.failedQueue = [];
  }

  // Enhanced API request helper with token refresh
  async request(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...(this.token && { 'Authorization': `Bearer ${this.token}` }),
        ...options.headers,
      },
      ...options,
    };

    // Handle request body
    if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
      config.body = JSON.stringify(config.body);
    }

    try {
      const response = await fetch(url, config);
      
      // Handle token expiration (401)
      if (response.status === 401 && this.token) {
        // If we're already refreshing, queue the request
        if (this.isRefreshing) {
          return new Promise((resolve, reject) => {
            this.failedQueue.push({ resolve, reject });
          }).then(token => {
            config.headers.Authorization = `Bearer ${token}`;
            return this.request(endpoint, config);
          }).catch(err => {
            throw err;
          });
        }

        this.isRefreshing = true;

        try {
          const newToken = await this.refreshToken();
          this.isRefreshing = false;
          
          // Retry the original request with new token
          config.headers.Authorization = `Bearer ${newToken}`;
          this.processQueue(null, newToken);
          
          return await this.request(endpoint, config);
        } catch (refreshError) {
          this.isRefreshing = false;
          this.processQueue(refreshError, null);
          this.redirectToLogin();
          throw refreshError;
        }
      }

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorData.message || errorMessage;
        } catch {
          // If response is not JSON, use status text
          errorMessage = response.statusText || errorMessage;
        }
        
        // Handle specific status codes
        if (response.status === 403) {
          errorMessage = 'You do not have permission to perform this action.';
        } else if (response.status === 404) {
          errorMessage = 'The requested resource was not found.';
        } else if (response.status >= 500) {
          errorMessage = 'Server error. Please try again later.';
        }
        
        throw new Error(errorMessage);
      }

      // Handle empty responses (204 No Content)
      if (response.status === 204) {
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error(`API Request failed for ${endpoint}:`, error);
      
      // Handle network errors
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error('Network error. Please check your connection.');
      }
      
      throw error;
    }
  }

  // Authentication endpoints
  async login(credentials) {
    const response = await this.request('/auth/login/', {
      method: 'POST',
      body: credentials
    });
    
    if (response.tokens) {
      this.setToken(response.tokens.access);
      if (response.tokens.refresh) {
        this.setRefreshToken(response.tokens.refresh);
      }
    }
    if (response.user) {
      this.setUser(response.user);
    }
    
    return response;
  }

  async logout() {
    try {
      // Call logout endpoint if available
      await this.request('/auth/logout/', {
        method: 'POST'
      });
    } catch (error) {
      console.warn('Logout API call failed, clearing local data anyway:', error);
    } finally {
      this.clearAuth();
    }
  }

  async register(userData) {
    const response = await this.request('/auth/register/', {
      method: 'POST',
      body: userData
    });
    
    // Auto-login after registration if tokens are returned
    if (response.tokens && response.user) {
      this.setToken(response.tokens.access);
      if (response.tokens.refresh) {
        this.setRefreshToken(response.tokens.refresh);
      }
      this.setUser(response.user);
    }
    
    return response;
  }

  // Check if user is authenticated
  isAuthenticated() {
    return !!this.token && !!this.user;
  }

  // Parking slot endpoints
  async getSlots() {
    return await this.request('/slots/');
  }

  async getAvailableSlots(filters = {}) {
    const queryParams = new URLSearchParams(filters).toString();
    const endpoint = queryParams ? `/slots/available/?${queryParams}` : '/slots/available/';
    return await this.request(endpoint);
  }

  async getSlotDetail(slotId) {
    return await this.request(`/slots/${slotId}/`);
  }

  // Admin slot management
  async getAdminSlots() {
    return await this.request('/admin/slots/');
  }

  async createParkingSlot(slotData) {
    return await this.request('/admin/slots/create/', {
      method: 'POST',
      body: slotData
    });
  }

  async updateParkingSlot(slotId, slotData) {
    return await this.request(`/admin/slots/${slotId}/update/`, {
      method: 'PUT',
      body: slotData
    });
  }

  async deleteParkingSlot(slotId) {
    return await this.request(`/admin/slots/${slotId}/delete/`, {
      method: 'DELETE'
    });
  }

  async changeSlotStatus(slotId, statusData) {
    return await this.request(`/admin/slots/${slotId}/change-status/`, {
      method: 'POST',
      body: statusData
    });
  }

  // Booking endpoints
  async createBooking(bookingData) {
    return await this.request('/bookings/create/', {
      method: 'POST',
      body: bookingData
    });
  }

  async getUserBookings() {
    return await this.request('/user/bookings/');
  }

  async getActiveBookings() {
    return await this.request('/user/bookings/active/');
  }

  async getBookingHistory() {
    return await this.request('/user/bookings/history/');
  }

  async checkInBooking(bookingId) {
    return await this.request(`/bookings/${bookingId}/check-in/`, {
      method: 'POST'
    });
  }

  async checkOutBooking(bookingId) {
    return await this.request(`/bookings/${bookingId}/check-out/`, {
      method: 'POST'
    });
  }

  async cancelBooking(bookingId, reason = '') {
    return await this.request(`/bookings/${bookingId}/cancel/`, {
      method: 'POST',
      body: { reason }
    });
  }

  async processPayment(bookingId, paymentData) {
    return await this.request(`/bookings/${bookingId}/payment/`, {
      method: 'POST',
      body: paymentData
    });
  }

  // Dashboard and user profile
  async getDashboardData() {
    return await this.request('/dashboard/');
  }

  async getUserProfile() {
    return await this.request('/user/profile/');
  }

  async updateUserProfile(profileData) {
    return await this.request('/user/profile/update/', {
      method: 'PUT',
      body: profileData
    });
  }

  async getParkingInfo() {
    return await this.request('/parking/info/');
  }

  // Test data
  async createTestSlots() {
    return await this.request('/admin/test-slots/', {
      method: 'POST'
    });
  }
}

// Create and export a singleton instance
const apiService = new ApiService();
export default apiService;