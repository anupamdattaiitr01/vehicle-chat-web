import { useEffect, useState, useRef, useCallback } from 'react';
import { socket } from './socket';
import CryptoJS from 'crypto-js';
import './App.css';

interface User {
  _id: string;
  name: string;
  role: string;
  phone: string;
}

interface DriverRoom {
  driverId: string;
  driverName: string;
  driverPhone: string;
  roomId: string;
}

interface Message {
  _id?: string;
  roomId?: string;
  senderId: string;
  content: string;
  createdAt?: string;
}

type ThemeMode = 'dark' | 'light';

const ENCRYPTION_KEY = 'fleet_payload_secret_2026';
const THEME_STORAGE_KEY = 'milo_web_theme';

export default function App() {
  // Theme State (synced with Milo Drive mobile app palette)
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  // Authentication & Registration State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authSuccess, setAuthSuccess] = useState('');

  // Dynamic Room State
  const [communityRoomId, setCommunityRoomId] = useState<string>('');
  const [driverRooms, setDriverRooms] = useState<DriverRoom[]>([]);
  const [currentRoom, setCurrentRoom] = useState<string>('');
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [driverSearch, setDriverSearch] = useState('');

  // Add Driver Modal State
  const [isAddDriverOpen, setIsAddDriverOpen] = useState(false);
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [driverPassword, setDriverPassword] = useState('');
  const [showDriverPassword, setShowDriverPassword] = useState(false);
  const [addingDriver, setAddingDriver] = useState(false);
  const [addDriverError, setAddDriverError] = useState('');

  // Chat State
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [typingStatus, setTypingStatus] = useState<string | null>(null);
  const [isSocketConnected, setIsSocketConnected] = useState(false);

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const activeRoomRef = useRef<string>('');

  useEffect(() => {
    activeRoomRef.current = currentRoom;
  }, [currentRoom]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Fetch dynamic rooms (Community Hub + all drivers assigned to this manager)
  const fetchMyRooms = useCallback(async (authToken: string) => {
    setLoadingRooms(true);
    try {
      const response = await fetch('http://localhost:5001/api/rooms/my-rooms', {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setCommunityRoomId(data.communityRoomId || '');
        setDriverRooms(data.drivers || []);
        setCurrentRoom((prev) => prev || data.communityRoomId || '');
      }
    } catch (error) {
      console.error('Failed to fetch assigned rooms:', error);
    } finally {
      setLoadingRooms(false);
    }
  }, []);

  // Handle both Manager Login and Manager Registration with AES encryption
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthSuccess('');
    setIsSubmittingAuth(true);

    try {
      if (isRegisterMode) {
        const rawPayload = JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          password,
          role: 'manager',
        });
        const encryptedPayload = CryptoJS.AES.encrypt(
          rawPayload,
          ENCRYPTION_KEY
        ).toString();

        const response = await fetch('http://localhost:5001/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: encryptedPayload }),
        });

        const data = await response.json();

        if (response.ok) {
          setAuthSuccess('Manager registered successfully! Please sign in.');
          setPassword('');
          setIsRegisterMode(false);
        } else {
          setAuthError(data.error || 'Registration failed');
        }
      } else {
        const rawPayload = JSON.stringify({
          phone: phone.trim(),
          password,
        });
        const encryptedPayload = CryptoJS.AES.encrypt(
          rawPayload,
          ENCRYPTION_KEY
        ).toString();

        const response = await fetch('http://localhost:5001/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: encryptedPayload }),
        });

        const data = await response.json();

        if (response.ok) {
          if (data.user.role !== 'manager') {
            setAuthError('Access denied: This dashboard is for Managers only.');
            return;
          }
          setToken(data.token);
          setCurrentUser(data.user);
        } else {
          setAuthError(data.error || 'Login failed');
        }
      }
    } catch {
      setAuthError('Network error. Is the backend running?');
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  // Provision a new driver under the logged-in Manager
  const handleAddDriverSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setAddDriverError('');

    if (!driverName.trim() || !driverPhone.trim() || !driverPassword.trim()) {
      setAddDriverError('Driver name, phone number, and password are required.');
      return;
    }

    setAddingDriver(true);
    try {
      const rawPayload = JSON.stringify({
        name: driverName.trim(),
        phone: driverPhone.trim(),
        password: driverPassword.trim(),
      });
      const encryptedPayload = CryptoJS.AES.encrypt(
        rawPayload,
        ENCRYPTION_KEY
      ).toString();

      const response = await fetch('http://localhost:5001/api/rooms/add-driver', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ data: encryptedPayload }),
      });

      const data = await response.json();

      if (response.ok) {
        await fetchMyRooms(token);
        if (data.driver?.roomId) {
          setMessages([]);
          setCurrentRoom(data.driver.roomId);
        }
        closeAddDriverModal();
      } else {
        setAddDriverError(data.error || 'Failed to add driver.');
      }
    } catch {
      setAddDriverError('Network error. Is the backend running?');
    } finally {
      setAddingDriver(false);
    }
  };

  const openAddDriverModal = () => {
    setDriverName('');
    setDriverPhone('');
    setDriverPassword('');
    setShowDriverPassword(false);
    setAddDriverError('');
    setIsAddDriverOpen(true);
  };

  const closeAddDriverModal = () => {
    if (addingDriver) return;
    setIsAddDriverOpen(false);
    setDriverName('');
    setDriverPhone('');
    setDriverPassword('');
    setShowDriverPassword(false);
    setAddDriverError('');
  };

  // Connect authenticated socket and load manager's rooms once logged in
  useEffect(() => {
    if (!currentUser || !token) return;

    fetchMyRooms(token);

    socket.auth = { token };
    socket.connect();

    socket.on('connect', () => setIsSocketConnected(true));
    socket.on('disconnect', () => setIsSocketConnected(false));

    socket.on('receive_message', (newMessage: Message) => {
      if (!newMessage.roomId || newMessage.roomId === activeRoomRef.current) {
        setMessages((prev) => [...prev, newMessage]);
      }
    });

    socket.on(
      'display_typing',
      (data: { userName?: string; isTyping: boolean }) => {
        if (data.isTyping && data.userName) {
          setTypingStatus(`${data.userName} is typing...`);
        } else {
          setTypingStatus(null);
        }
      }
    );

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('receive_message');
      socket.off('display_typing');
      socket.disconnect();
      setIsSocketConnected(false);
    };
  }, [currentUser, token, fetchMyRooms]);

  // Fetch message history and join socket room whenever currentRoom changes
  useEffect(() => {
    if (!currentUser || !token || !currentRoom) return;

    setTypingStatus(null);

    const fetchHistory = async () => {
      try {
        const response = await fetch(
          `http://localhost:5001/api/messages/${currentRoom}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
        if (response.ok) {
          const data = await response.json();
          setMessages(data);
        }
      } catch (error) {
        console.error('Failed to fetch message history:', error);
      }
    };

    fetchHistory();
    socket.emit('join_room', { roomId: currentRoom, userId: currentUser._id });
  }, [currentRoom, currentUser, token]);

  const handleSendMessage = () => {
    if (!input.trim() || !currentUser || !currentRoom) return;

    socket.emit('send_message', {
      roomId: currentRoom,
      senderId: currentUser._id,
      content: input.trim(),
    });

    setInput('');
    socket.emit('stop_typing', { roomId: currentRoom });
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
    if (!currentUser || !currentRoom) return;

    socket.emit('typing', { roomId: currentRoom, userName: currentUser.name });

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('stop_typing', { roomId: currentRoom });
    }, 1500);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setToken(null);
    setCommunityRoomId('');
    setDriverRooms([]);
    setCurrentRoom('');
    setMessages([]);
    setPassword('');
    setIsAddDriverOpen(false);
  };

  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const isCommunityActive = currentRoom === communityRoomId;
  const activeDriver = driverRooms.find((d) => d.roomId === currentRoom);
  const filteredDrivers = driverRooms.filter(
    (d) =>
      d.driverName.toLowerCase().includes(driverSearch.trim().toLowerCase()) ||
      d.driverPhone.includes(driverSearch.trim())
  );

  // =========================================================================
  // AUTH VIEW (Manager Sign In / Create Manager Account)
  // =========================================================================
  if (!currentUser || !token) {
    return (
      <div
        style={{
          minHeight: '100vh',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          background:
            'radial-gradient(circle at 85% 12%, var(--milo-glow) 0%, var(--milo-bg) 58%)',
          padding: '20px',
        }}
      >
        {/* Top-Right Dark / Light Pill Switcher */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <ThemePillToggle theme={theme} onChange={setTheme} />
        </div>

        <div
          style={{
            flex: 1,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '16px 0',
          }}
        >
          <form
            onSubmit={handleAuthSubmit}
            style={{
              backgroundColor: 'var(--milo-card)',
              border: '1px solid var(--milo-border)',
              borderRadius: '24px',
              padding: '32px 28px',
              width: '100%',
              maxWidth: '400px',
              boxShadow: 'var(--milo-shadow)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            {/* Milo Drive Logo Badge */}
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div
                style={{
                  backgroundColor: '#FAF7F8',
                  border: '1px solid rgba(110, 29, 61, 0.22)',
                  borderRadius: '18px',
                  padding: '14px 24px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <img
                  src="/milo_logo.png"
                  alt="Milo Drive"
                  style={{ height: '48px', objectFit: 'contain', display: 'block' }}
                />
              </div>
            </div>

            <div style={{ textAlign: 'center', marginTop: '4px' }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: '1.45rem',
                  fontWeight: 700,
                  color: 'var(--milo-text)',
                  letterSpacing: '-0.02em',
                }}
              >
                {isRegisterMode ? 'Create Manager Account' : 'Manager Sign In'}
              </h2>
              <p
                style={{
                  margin: '6px 0 0',
                  fontSize: '0.84rem',
                  color: 'var(--milo-text-muted)',
                }}
              >
                {isRegisterMode
                  ? 'Register as a fleet manager to onboard and chat with your drivers'
                  : 'Sign in to manage your fleet & driver conversations'}
              </p>
            </div>

            {authError && (
              <div
                style={{
                  backgroundColor: 'var(--milo-error-bg)',
                  color: 'var(--milo-error-text)',
                  border: '1px solid rgba(231, 76, 60, 0.35)',
                  borderRadius: '12px',
                  padding: '10px 12px',
                  fontSize: '0.84rem',
                  textAlign: 'center',
                  fontWeight: 500,
                }}
              >
                {authError}
              </div>
            )}

            {authSuccess && (
              <div
                style={{
                  backgroundColor: 'var(--milo-success-bg)',
                  color: 'var(--milo-success-text)',
                  border: '1px solid rgba(46, 204, 113, 0.35)',
                  borderRadius: '12px',
                  padding: '10px 12px',
                  fontSize: '0.84rem',
                  textAlign: 'center',
                  fontWeight: 500,
                }}
              >
                {authSuccess}
              </div>
            )}

            {isRegisterMode && (
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    color: 'var(--milo-text-muted)',
                    marginBottom: '6px',
                  }}
                >
                  Full Name
                </label>
                <input
                  type="text"
                  className="milo-input"
                  placeholder="e.g. Tanush Sharma"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            )}

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: 'var(--milo-text-muted)',
                  marginBottom: '6px',
                }}
              >
                Phone Number
              </label>
              <input
                type="tel"
                className="milo-input"
                placeholder="e.g. 9876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: 'var(--milo-text-muted)',
                  marginBottom: '6px',
                }}
              >
                Password
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type={showAuthPassword ? 'text' : 'password'}
                  className="milo-input"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ paddingRight: '62px' }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowAuthPassword((prev) => !prev)}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--milo-text-muted)',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: '4px 6px',
                  }}
                >
                  {showAuthPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {isRegisterMode && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '9px 12px',
                  borderRadius: '10px',
                  backgroundColor: 'var(--milo-input)',
                  border: '1px solid var(--milo-border)',
                  fontSize: '0.82rem',
                  color: 'var(--milo-text-muted)',
                }}
              >
                <span>Account Role</span>
                <span
                  style={{
                    backgroundColor: 'var(--milo-amber-bg)',
                    color: 'var(--milo-amber-text)',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    letterSpacing: '0.04em',
                  }}
                >
                  FLEET MANAGER
                </span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmittingAuth}
              className="milo-btn-primary"
              style={{ padding: '13px', fontSize: '0.96rem', marginTop: '4px' }}
            >
              {isSubmittingAuth
                ? 'Please wait...'
                : isRegisterMode
                ? 'Create Manager Account'
                : 'Sign In'}
            </button>

            <button
              type="button"
              onClick={() => {
                setIsRegisterMode(!isRegisterMode);
                setAuthError('');
                setAuthSuccess('');
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--milo-burgundy-light)',
                cursor: 'pointer',
                fontSize: '0.84rem',
                fontWeight: 600,
                marginTop: '2px',
              }}
            >
              {isRegisterMode
                ? 'Already have a manager account? Sign In'
                : 'New Manager? Create an account'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // =========================================================================
  // FLEET MANAGER DASHBOARD VIEW
  // =========================================================================
  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        backgroundColor: 'var(--milo-bg)',
        color: 'var(--milo-text)',
      }}
    >
      {/* Left Fleet Sidebar */}
      <aside
        style={{
          width: '320px',
          minWidth: '300px',
          backgroundColor: 'var(--milo-card)',
          borderRight: '1px solid var(--milo-border)',
          display: 'flex',
          flexDirection: 'column',
          padding: '18px 16px',
        }}
      >
        {/* Brand Header + Theme Toggle */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                backgroundColor: '#FAF7F8',
                borderRadius: '10px',
                padding: '6px 10px',
                border: '1px solid rgba(110, 29, 61, 0.2)',
              }}
            >
              <img
                src="/milo_logo.png"
                alt="Milo Drive"
                style={{ height: '24px', display: 'block', objectFit: 'contain' }}
              />
            </div>
          </div>

          <ThemePillToggle theme={theme} onChange={setTheme} compact />
        </div>

        {/* Logged-In Manager Profile Card */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px',
            borderRadius: '16px',
            backgroundColor: 'var(--milo-input)',
            border: '1px solid var(--milo-border)',
            marginBottom: '16px',
          }}
        >
          <div style={{ position: 'relative' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '50%',
                backgroundColor: '#8C5230',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '1rem',
              }}
            >
              {currentUser.name.charAt(0).toUpperCase()}
            </div>
            <span
              style={{
                position: 'absolute',
                right: 0,
                bottom: 0,
                width: '11px',
                height: '11px',
                borderRadius: '50%',
                backgroundColor: isSocketConnected
                  ? 'var(--milo-green)'
                  : '#95a5a6',
                border: '2px solid var(--milo-input)',
              }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: '0.94rem',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {currentUser.name}
            </div>
            <div
              style={{
                fontSize: '0.78rem',
                color: 'var(--milo-text-muted)',
              }}
            >
              {currentUser.phone} • Manager
            </div>
          </div>
        </div>

        {/* Driver Search Bar */}
        <div style={{ marginBottom: '14px' }}>
          <input
            type="text"
            className="milo-input"
            placeholder="Search drivers by name or phone..."
            value={driverSearch}
            onChange={(e) => setDriverSearch(e.target.value)}
            style={{ padding: '9px 12px', fontSize: '0.84rem' }}
          />
        </div>

        {/* Scrollable Channels & Driver List */}
        <div
          className="milo-scroll"
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            paddingRight: '2px',
          }}
        >
          <div
            style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              color: 'var(--milo-text-muted)',
              padding: '4px 6px',
            }}
          >
            FLEET BROADCAST
          </div>

          {/* Community Hub Row */}
          <button
            type="button"
            className="milo-thread-item"
            onClick={() => {
              if (currentRoom !== communityRoomId) {
                setMessages([]);
                setCurrentRoom(communityRoomId);
              }
            }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 12px',
              borderRadius: '14px',
              border: isCommunityActive
                ? '1px solid var(--milo-burgundy-light)'
                : '1px solid transparent',
              backgroundColor: isCommunityActive
                ? 'rgba(110, 29, 61, 0.22)'
                : 'transparent',
              color: 'var(--milo-text)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '50%',
                backgroundColor: 'var(--milo-burgundy)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: '0.76rem',
                letterSpacing: '-0.02em',
                flexShrink: 0,
              }}
            >
              milo
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>
                Community Hub
              </div>
              <div
                style={{
                  fontSize: '0.76rem',
                  color: 'var(--milo-text-muted)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                All drivers & fleet managers
              </div>
            </div>
          </button>

          {/* My Drivers Section Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: '14px',
              marginBottom: '4px',
              padding: '0 4px',
            }}
          >
            <span
              style={{
                fontSize: '0.7rem',
                fontWeight: 700,
                letterSpacing: '0.08em',
                color: 'var(--milo-text-muted)',
              }}
            >
              MY DRIVERS ({driverRooms.length})
            </span>

            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                onClick={openAddDriverModal}
                className="milo-btn-primary"
                style={{
                  padding: '5px 10px',
                  borderRadius: '8px',
                  fontSize: '0.75rem',
                }}
              >
                + Add Driver
              </button>
              <button
                type="button"
                onClick={() => fetchMyRooms(token)}
                disabled={loadingRooms}
                title="Refresh drivers"
                style={{
                  backgroundColor: 'var(--milo-input)',
                  color: 'var(--milo-text-muted)',
                  border: '1px solid var(--milo-border)',
                  borderRadius: '8px',
                  padding: '4px 8px',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                }}
              >
                {loadingRooms ? '...' : '↻'}
              </button>
            </div>
          </div>

          {filteredDrivers.length === 0 ? (
            <div
              style={{
                padding: '16px 12px',
                borderRadius: '14px',
                border: '1px dashed var(--milo-border)',
                color: 'var(--milo-text-muted)',
                fontSize: '0.8rem',
                textAlign: 'center',
                lineHeight: 1.45,
                marginTop: '4px',
              }}
            >
              {driverRooms.length === 0
                ? 'No drivers assigned yet. Click "+ Add Driver" to onboard your first driver.'
                : 'No matching drivers found.'}
            </div>
          ) : (
            filteredDrivers.map((driver) => {
              const isSelected = currentRoom === driver.roomId;
              return (
                <button
                  key={driver.driverId}
                  type="button"
                  className="milo-thread-item"
                  onClick={() => {
                    if (currentRoom !== driver.roomId) {
                      setMessages([]);
                      setCurrentRoom(driver.roomId);
                    }
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 12px',
                    borderRadius: '14px',
                    border: isSelected
                      ? '1px solid var(--milo-burgundy-light)'
                      : '1px solid transparent',
                    backgroundColor: isSelected
                      ? 'rgba(110, 29, 61, 0.22)'
                      : 'transparent',
                    color: 'var(--milo-text)',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      backgroundColor: isSelected
                        ? 'var(--milo-burgundy)'
                        : 'var(--milo-input)',
                      border: '1px solid var(--milo-border)',
                      color: isSelected ? '#ffffff' : 'var(--milo-text)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '0.92rem',
                      flexShrink: 0,
                    }}
                  >
                    {driver.driverName.charAt(0).toUpperCase()}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: '0.9rem',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {driver.driverName}
                    </div>
                    <div
                      style={{
                        fontSize: '0.76rem',
                        color: 'var(--milo-text-muted)',
                      }}
                    >
                      {driver.driverPhone}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Sign Out Button */}
        <button
          type="button"
          onClick={handleLogout}
          style={{
            marginTop: '14px',
            padding: '11px',
            borderRadius: '12px',
            border: '1px solid rgba(231, 76, 60, 0.35)',
            backgroundColor: 'var(--milo-error-bg)',
            color: 'var(--milo-error-text)',
            fontWeight: 600,
            fontSize: '0.88rem',
            cursor: 'pointer',
          }}
        >
          Sign Out
        </button>
      </aside>

      {/* Main Conversation Area */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          background:
            'radial-gradient(circle at 88% 8%, var(--milo-glow) 0%, var(--milo-bg) 52%)',
        }}
      >
        {/* Top Conversation Header */}
        <header
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid var(--milo-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ position: 'relative' }}>
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '50%',
                  backgroundColor: isCommunityActive
                    ? 'var(--milo-burgundy)'
                    : '#8C5230',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: isCommunityActive ? 800 : 700,
                  fontSize: isCommunityActive ? '0.82rem' : '1.05rem',
                }}
              >
                {isCommunityActive
                  ? 'milo'
                  : (activeDriver?.driverName.charAt(0).toUpperCase() || 'D')}
              </div>
              <span
                style={{
                  position: 'absolute',
                  right: 0,
                  bottom: 0,
                  width: '11px',
                  height: '11px',
                  borderRadius: '50%',
                  backgroundColor: isSocketConnected
                    ? 'var(--milo-green)'
                    : '#f39c12',
                  border: '2px solid var(--milo-bg)',
                }}
              />
            </div>

            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <h3
                  style={{
                    margin: 0,
                    fontSize: '1.06rem',
                    fontWeight: 700,
                    color: 'var(--milo-text)',
                  }}
                >
                  {isCommunityActive
                    ? 'Community Hub'
                    : activeDriver?.driverName || 'Personal Chat'}
                </h3>
                {!isCommunityActive && activeDriver && (
                  <span
                    style={{
                      backgroundColor: 'var(--milo-amber-bg)',
                      color: 'var(--milo-amber-text)',
                      padding: '2px 8px',
                      borderRadius: '6px',
                      fontSize: '0.68rem',
                      fontWeight: 800,
                      letterSpacing: '0.04em',
                    }}
                  >
                    ASSIGNED DRIVER
                  </span>
                )}
              </div>

              <div
                style={{
                  fontSize: '0.8rem',
                  marginTop: '2px',
                  color: typingStatus
                    ? 'var(--milo-green)'
                    : 'var(--milo-text-muted)',
                  fontWeight: typingStatus ? 600 : 400,
                }}
              >
                {typingStatus
                  ? typingStatus
                  : isCommunityActive
                  ? `Fleet Channel • ${isSocketConnected ? 'Online' : 'Reconnecting...'}`
                  : `${activeDriver?.driverPhone || ''} • ${isSocketConnected ? 'Online' : 'Reconnecting...'}`}
              </div>
            </div>
          </div>
        </header>

        {/* Scrollable Message Stream */}
        <div
          className="milo-scroll"
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px 28px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Today Pill Divider */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              marginBottom: '18px',
            }}
          >
            <span
              style={{
                backgroundColor: 'var(--milo-card)',
                border: '1px solid var(--milo-border)',
                color: 'var(--milo-text-muted)',
                fontSize: '0.74rem',
                fontWeight: 600,
                padding: '4px 14px',
                borderRadius: '999px',
              }}
            >
              Today
            </span>
          </div>

          {messages.length === 0 && (
            <div
              style={{
                margin: 'auto',
                textAlign: 'center',
                color: 'var(--milo-text-muted)',
                fontSize: '0.88rem',
              }}
            >
              {isCommunityActive
                ? 'Broadcast fleet updates to all drivers in Community Hub.'
                : `Send a direct message to ${activeDriver?.driverName || 'your driver'}.`}
            </div>
          )}

          {messages.map((msg, idx) => {
            const isMe = msg.senderId === currentUser._id;
            return (
              <div
                key={msg._id || idx}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isMe ? 'flex-end' : 'flex-start',
                  marginBottom: '14px',
                }}
              >
                <div
                  style={{
                    maxWidth: '64%',
                    padding: '11px 16px',
                    borderRadius: isMe
                      ? '18px 18px 5px 18px'
                      : '18px 18px 18px 5px',
                    backgroundColor: isMe
                      ? 'var(--milo-outgoing)'
                      : 'var(--milo-incoming)',
                    color: isMe ? '#ffffff' : 'var(--milo-text)',
                    border: isMe ? 'none' : '1px solid var(--milo-border)',
                    fontSize: '0.92rem',
                    lineHeight: 1.45,
                    wordBreak: 'break-word',
                  }}
                >
                  {msg.content}
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '0.72rem',
                    color: 'var(--milo-text-muted)',
                    marginTop: '4px',
                    padding: '0 4px',
                  }}
                >
                  <span>{formatTime(msg.createdAt)}</span>
                  {isMe && (
                    <span style={{ color: '#38BDF8', fontWeight: 700 }}>✓✓</span>
                  )}
                </div>
              </div>
            );
          })}

          <div ref={messagesEndRef} />
        </div>

        {/* Rounded Pill Input Bar */}
        <div
          style={{
            padding: '14px 24px 18px',
            borderTop: '1px solid var(--milo-border)',
            backgroundColor: 'var(--milo-bg)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <input
              type="text"
              value={input}
              onChange={handleTyping}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Type a message..."
              style={{
                flex: 1,
                padding: '13px 20px',
                borderRadius: '999px',
                border: '1px solid var(--milo-border)',
                backgroundColor: 'var(--milo-input)',
                color: 'var(--milo-text)',
                fontSize: '0.92rem',
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={handleSendMessage}
              disabled={!input.trim()}
              className="milo-btn-primary"
              title="Send message"
              style={{
                width: '46px',
                height: '46px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.05rem',
                flexShrink: 0,
              }}
            >
              ➤
            </button>
          </div>
        </div>
      </main>

      {/* =================================================================== */}
      {/* ADD DRIVER MODAL                                                    */}
      {/* =================================================================== */}
      {isAddDriverOpen && (
        <div
          onClick={closeAddDriverModal}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '16px',
            zIndex: 1000,
          }}
        >
          <form
            onSubmit={handleAddDriverSubmit}
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'var(--milo-card)',
              border: '1px solid var(--milo-border)',
              borderRadius: '22px',
              padding: '26px',
              width: '100%',
              maxWidth: '400px',
              boxShadow: 'var(--milo-shadow)',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: '1.15rem',
                  fontWeight: 700,
                  color: 'var(--milo-text)',
                }}
              >
                Add Driver to Fleet
              </h3>
              <button
                type="button"
                onClick={closeAddDriverModal}
                disabled={addingDriver}
                style={{
                  background: 'var(--milo-input)',
                  border: '1px solid var(--milo-border)',
                  borderRadius: '8px',
                  width: '30px',
                  height: '30px',
                  color: 'var(--milo-text-muted)',
                  fontSize: '1.1rem',
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            </div>

            <p
              style={{
                margin: 0,
                fontSize: '0.83rem',
                color: 'var(--milo-text-muted)',
                lineHeight: 1.45,
              }}
            >
              Create login credentials for your driver. Share this phone number
              and password with them to sign in on the Milo Drive mobile app.
            </p>

            {addDriverError && (
              <div
                style={{
                  backgroundColor: 'var(--milo-error-bg)',
                  color: 'var(--milo-error-text)',
                  border: '1px solid rgba(231, 76, 60, 0.35)',
                  borderRadius: '12px',
                  padding: '10px 12px',
                  fontSize: '0.84rem',
                  fontWeight: 500,
                }}
              >
                {addDriverError}
              </div>
            )}

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: 'var(--milo-text-muted)',
                  marginBottom: '6px',
                }}
              >
                Driver Full Name
              </label>
              <input
                type="text"
                className="milo-input"
                placeholder="e.g. Hariom Kumar"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                required
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: 'var(--milo-text-muted)',
                  marginBottom: '6px',
                }}
              >
                Driver Phone Number
              </label>
              <input
                type="tel"
                className="milo-input"
                placeholder="e.g. 8000000011"
                value={driverPhone}
                onChange={(e) => setDriverPhone(e.target.value)}
                required
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: 'var(--milo-text-muted)',
                  marginBottom: '6px',
                }}
              >
                Assign Login Password
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type={showDriverPassword ? 'text' : 'password'}
                  className="milo-input"
                  placeholder="Create password for driver"
                  value={driverPassword}
                  onChange={(e) => setDriverPassword(e.target.value)}
                  style={{ paddingRight: '62px' }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowDriverPassword((prev) => !prev)}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--milo-text-muted)',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: '4px 6px',
                  }}
                >
                  {showDriverPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
                marginTop: '6px',
              }}
            >
              <button
                type="button"
                onClick={closeAddDriverModal}
                disabled={addingDriver}
                style={{
                  padding: '10px 16px',
                  borderRadius: '12px',
                  border: '1px solid var(--milo-border)',
                  backgroundColor: 'var(--milo-input)',
                  color: 'var(--milo-text)',
                  fontWeight: 600,
                  fontSize: '0.86rem',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={addingDriver}
                className="milo-btn-primary"
                style={{
                  padding: '10px 18px',
                  fontSize: '0.86rem',
                }}
              >
                {addingDriver ? 'Adding...' : 'Create & Assign Driver'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// REUSABLE DARK / LIGHT PILL TOGGLE
// ===========================================================================
function ThemePillToggle({
  theme,
  onChange,
  compact = false,
}: {
  theme: ThemeMode;
  onChange: (mode: ThemeMode) => void;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        padding: compact ? '3px' : '4px',
        borderRadius: '999px',
        backgroundColor: 'var(--milo-card)',
        border: '1px solid var(--milo-border)',
      }}
    >
      {(['dark', 'light'] as ThemeMode[]).map((mode) => {
        const selected = theme === mode;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            style={{
              padding: compact ? '4px 10px' : '6px 14px',
              borderRadius: '999px',
              border: 'none',
              backgroundColor: selected ? 'var(--milo-burgundy)' : 'transparent',
              color: selected ? '#ffffff' : 'var(--milo-text-muted)',
              fontSize: compact ? '0.72rem' : '0.78rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background-color 0.18s ease, color 0.18s ease',
            }}
          >
            {mode === 'dark' ? 'Dark' : 'Light'}
          </button>
        );
      })}
    </div>
  );
}