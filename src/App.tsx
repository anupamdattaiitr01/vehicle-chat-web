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

interface Booking {
  _id: string;
  managerId: string;
  managerName?: string;
  driverId: string;
  driverName?: string;
  roomId: string;
  passengerName: string;
  passengerPhone: string;
  pickupLocation: string;
  dropLocation: string;
  scheduledTime: string;
  scheduledAt: string;
  estimatedEndAt: string;
  durationMinutes: number;
  notes?: string;
  status: 'pending' | 'confirmed' | 'query_raised' | 'cancelled';
  queryMessage?: string;
  createdAt?: string;
}

type ThemeMode = 'dark' | 'light';

const ENCRYPTION_KEY = 'fleet_payload_secret_2026';
const THEME_STORAGE_KEY = 'milo_web_theme';
const PHONE_REGEX = /^\d{10}$/;

function sanitizePhoneInput(value: string): string {
  return value.replace(/\D/g, '').slice(0, 10);
}

function toDateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatScheduleLabel(date: Date, durationMinutes: number): string {
  const datePart = date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const timePart = date.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const hrs = durationMinutes / 60;
  const durationLabel =
    durationMinutes < 60
      ? `${durationMinutes} mins`
      : Number.isInteger(hrs)
      ? `${hrs} hr${hrs > 1 ? 's' : ''}`
      : `${hrs.toFixed(1)} hrs`;

  return `${datePart}, ${timePart} (${durationLabel})`;
}

function formatCompactTriggerDate(value: string): string {
  if (!value) return 'Select date & time';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return 'Select date & time';
  const datePart = dt.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const timePart = dt.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return `${datePart}, ${timePart}`;
}

export default function App() {
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

  // Ride Bookings & Assign Ride Modal State
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [isAssignRideOpen, setIsAssignRideOpen] = useState(false);
  const [isDateTimePickerOpen, setIsDateTimePickerOpen] = useState(false);
  const [passengerName, setPassengerName] = useState('');
  const [passengerPhone, setPassengerPhone] = useState('');
  const [pickupLocation, setPickupLocation] = useState('');
  const [dropLocation, setDropLocation] = useState('');
  const [scheduledDateTimeLocal, setScheduledDateTimeLocal] = useState('');
  const [minDateTimeLocal, setMinDateTimeLocal] = useState('');
  const [durationMinutes, setDurationMinutes] = useState<number>(60);
  const [rideNotes, setRideNotes] = useState('');
  const [assigningRide, setAssigningRide] = useState(false);
  const [assignRideError, setAssignRideError] = useState('');

  // Reallocate & Cancel Ride Modal State
  const [rideToReallocate, setRideToReallocate] = useState<Booking | null>(null);
  const [selectedNewDriverId, setSelectedNewDriverId] = useState<string>('');
  const [reallocatingRide, setReallocatingRide] = useState(false);
  const [reallocateError, setReallocateError] = useState('');

  const [rideToCancel, setRideToCancel] = useState<Booking | null>(null);
  const [cancellingRide, setCancellingRide] = useState(false);
  const [cancelError, setCancelError] = useState('');

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

  const fetchMyBookings = useCallback(async (authToken: string) => {
    try {
      const response = await fetch(
        'http://localhost:5001/api/bookings/my-bookings',
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        }
      );
      if (response.ok) {
        const data = (await response.json()) as Booking[];
        setBookings(data.filter((b) => b.status !== 'cancelled'));
      }
    } catch (error) {
      console.error('Failed to fetch bookings:', error);
    }
  }, []);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthSuccess('');

    const cleanPhone = sanitizePhoneInput(phone);
    if (!PHONE_REGEX.test(cleanPhone)) {
      setAuthError('Phone number must be exactly 10 digits.');
      return;
    }

    setIsSubmittingAuth(true);

    try {
      if (isRegisterMode) {
        const rawPayload = JSON.stringify({
          name: name.trim(),
          phone: cleanPhone,
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
          phone: cleanPhone,
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

  const handleAddDriverSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setAddDriverError('');

    const cleanDriverPhone = sanitizePhoneInput(driverPhone);
    if (!driverName.trim() || !cleanDriverPhone || !driverPassword.trim()) {
      setAddDriverError('Driver name, phone number, and password are required.');
      return;
    }

    if (!PHONE_REGEX.test(cleanDriverPhone)) {
      setAddDriverError('Driver phone number must be exactly 10 digits.');
      return;
    }

    setAddingDriver(true);
    try {
      const rawPayload = JSON.stringify({
        name: driverName.trim(),
        phone: cleanDriverPhone,
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

  const findScheduleConflict = useCallback(
    (
      driverId: string,
      candidateStart: Date,
      candidateDurationMins: number,
      excludeBookingId?: string
    ): Booking | undefined => {
      const candidateEnd = new Date(
        candidateStart.getTime() + candidateDurationMins * 60_000
      );
      return bookings.find((b) => {
        if (excludeBookingId && b._id === excludeBookingId) return false;
        if (b.driverId !== driverId) return false;
        if (b.status === 'cancelled') return false;
        const existingStart = new Date(b.scheduledAt);
        const existingEnd = new Date(b.estimatedEndAt);
        if (
          Number.isNaN(existingStart.getTime()) ||
          Number.isNaN(existingEnd.getTime())
        ) {
          return false;
        }
        return existingStart < candidateEnd && existingEnd > candidateStart;
      });
    },
    [bookings]
  );

  const handleAssignRideSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !activeDriver) return;

    setAssignRideError('');

    const cleanPassengerPhone = sanitizePhoneInput(passengerPhone);
    if (
      !passengerName.trim() ||
      !cleanPassengerPhone ||
      !pickupLocation.trim() ||
      !dropLocation.trim() ||
      !scheduledDateTimeLocal
    ) {
      setAssignRideError(
        'Passenger name, phone, pickup, drop, and pickup date & time are required.'
      );
      return;
    }

    if (!PHONE_REGEX.test(cleanPassengerPhone)) {
      setAssignRideError('Passenger phone number must be exactly 10 digits.');
      return;
    }

    const selectedStart = new Date(scheduledDateTimeLocal);
    if (Number.isNaN(selectedStart.getTime())) {
      setAssignRideError('Please choose a valid pickup date and time.');
      return;
    }

    if (selectedStart.getTime() < Date.now() - 60_000) {
      setAssignRideError(
        'Pickup time cannot be in the past. Select the current or a future time.'
      );
      return;
    }

    const conflict = findScheduleConflict(
      activeDriver.driverId,
      selectedStart,
      durationMinutes
    );
    if (conflict) {
      setAssignRideError(
        `Cross-timing detected: ${activeDriver.driverName} is already booked for ${conflict.passengerName} at ${conflict.scheduledTime}.`
      );
      return;
    }

    setAssigningRide(true);
    try {
      const formattedLabel = formatScheduleLabel(selectedStart, durationMinutes);
      const response = await fetch('http://localhost:5001/api/bookings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          driverId: activeDriver.driverId,
          passengerName: passengerName.trim(),
          passengerPhone: cleanPassengerPhone,
          pickupLocation: pickupLocation.trim(),
          dropLocation: dropLocation.trim(),
          scheduledAt: selectedStart.toISOString(),
          scheduledTime: formattedLabel,
          durationMinutes,
          notes: rideNotes.trim(),
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setBookings((prev) =>
          [...prev, data as Booking].sort(
            (a, b) =>
              new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
          )
        );
        closeAssignRideModal();
      } else {
        setAssignRideError(data.error || 'Failed to assign ride.');
      }
    } catch {
      setAssignRideError('Network error. Is the backend running?');
    } finally {
      setAssigningRide(false);
    }
  };

  const handleConfirmCancelRide = async () => {
    if (!token || !rideToCancel) return;
    setCancellingRide(true);
    setCancelError('');

    try {
      const response = await fetch(
        `http://localhost:5001/api/bookings/${rideToCancel._id}/cancel`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json();
      if (response.ok) {
        setBookings((prev) => prev.filter((b) => b._id !== rideToCancel._id));
        setRideToCancel(null);
      } else {
        setCancelError(data.error || 'Failed to cancel ride.');
      }
    } catch {
      setCancelError('Network error. Is the backend running?');
    } finally {
      setCancellingRide(false);
    }
  };

  const handleConfirmReallocateRide = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !rideToReallocate || !selectedNewDriverId) return;

    setReallocatingRide(true);
    setReallocateError('');

    try {
      const response = await fetch(
        `http://localhost:5001/api/bookings/${rideToReallocate._id}/reallocate`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ newDriverId: selectedNewDriverId }),
        }
      );

      const data = await response.json();
      if (response.ok) {
        const updated = data as Booking;
        setBookings((prev) =>
          prev
            .map((b) => (b._id === updated._id ? updated : b))
            .sort(
              (a, b) =>
                new Date(a.scheduledAt).getTime() -
                new Date(b.scheduledAt).getTime()
            )
        );
        setRideToReallocate(null);
        setSelectedNewDriverId('');
      } else {
        setReallocateError(data.error || 'Failed to reallocate ride.');
      }
    } catch {
      setReallocateError('Network error. Is the backend running?');
    } finally {
      setReallocatingRide(false);
    }
  };

  const openAssignRideModal = () => {
    const now = new Date();
    const minVal = toDateTimeLocalValue(now);
    const defaultStart = new Date(now.getTime() + 5 * 60_000);
    setMinDateTimeLocal(minVal);
    setScheduledDateTimeLocal(toDateTimeLocalValue(defaultStart));
    setDurationMinutes(60);
    setPassengerName('');
    setPassengerPhone('');
    setPickupLocation('');
    setDropLocation('');
    setRideNotes('');
    setAssignRideError('');
    setIsDateTimePickerOpen(false);
    setIsAssignRideOpen(true);
  };

  const closeAssignRideModal = () => {
    if (assigningRide) return;
    setIsAssignRideOpen(false);
    setIsDateTimePickerOpen(false);
    setAssignRideError('');
  };

  const openReallocateModal = (ride: Booking) => {
    setReallocateError('');
    const candidates = driverRooms.filter((d) => d.driverId !== ride.driverId);
    const firstAvailable = candidates.find(
      (d) =>
        !findScheduleConflict(
          d.driverId,
          new Date(ride.scheduledAt),
          ride.durationMinutes,
          ride._id
        )
    );
    setSelectedNewDriverId(firstAvailable?.driverId || '');
    setRideToReallocate(ride);
  };

  useEffect(() => {
    if (!currentUser || !token) return;

    fetchMyRooms(token);
    fetchMyBookings(token);

    socket.auth = { token };
    socket.connect();

    socket.on('connect', () => setIsSocketConnected(true));
    socket.on('disconnect', () => setIsSocketConnected(false));

    socket.on('receive_message', (newMessage: Message) => {
      if (!newMessage.roomId || newMessage.roomId === activeRoomRef.current) {
        setMessages((prev) => {
          if (
            newMessage._id &&
            prev.some((m) => m._id && m._id === newMessage._id)
          ) {
            return prev;
          }
          return [...prev, newMessage];
        });
      }
    });

    socket.on('booking_status_updated', (updatedBooking: Booking) => {
      setBookings((prev) => {
        if (updatedBooking.status === 'cancelled') {
          return prev.filter((b) => b._id !== updatedBooking._id);
        }
        const exists = prev.some((b) => b._id === updatedBooking._id);
        const nextList = exists
          ? prev.map((b) =>
              b._id === updatedBooking._id ? { ...b, ...updatedBooking } : b
            )
          : [...prev, updatedBooking];
        return nextList.sort(
          (a, b) =>
            new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
        );
      });
    });

    socket.on(
      'booking_reallocated',
      (payload: { bookingId: string; booking: Booking }) => {
        if (!payload?.booking) return;
        setBookings((prev) => {
          const exists = prev.some((b) => b._id === payload.booking._id);
          const nextList = exists
            ? prev.map((b) =>
                b._id === payload.booking._id ? payload.booking : b
              )
            : [...prev, payload.booking];
          return nextList.sort(
            (a, b) =>
              new Date(a.scheduledAt).getTime() -
              new Date(b.scheduledAt).getTime()
          );
        });
      }
    );

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
      socket.off('booking_status_updated');
      socket.off('booking_reallocated');
      socket.off('display_typing');
      socket.disconnect();
      setIsSocketConnected(false);
    };
  }, [currentUser, token, fetchMyRooms, fetchMyBookings]);

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
    setBookings([]);
    setCurrentRoom('');
    setMessages([]);
    setPassword('');
    setIsAddDriverOpen(false);
    setIsAssignRideOpen(false);
    setRideToReallocate(null);
    setRideToCancel(null);
  };

  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getBookingBadgeStyle = (status: Booking['status']) => {
    if (status === 'confirmed') {
      return {
        label: 'CONFIRMED',
        bg: 'var(--milo-success-bg)',
        color: 'var(--milo-success-text)',
        border: 'rgba(46, 204, 113, 0.35)',
      };
    }
    if (status === 'query_raised') {
      return {
        label: 'QUERY RAISED',
        bg: 'var(--milo-error-bg)',
        color: 'var(--milo-error-text)',
        border: 'rgba(231, 76, 60, 0.35)',
      };
    }
    return {
      label: 'PENDING',
      bg: 'var(--milo-amber-bg)',
      color: 'var(--milo-amber-text)',
      border: 'rgba(245, 158, 11, 0.35)',
    };
  };

  const isCommunityActive = currentRoom === communityRoomId;
  const activeDriver = driverRooms.find((d) => d.roomId === currentRoom);

  const activeDriverUpcomingBookings = activeDriver
    ? bookings
        .filter(
          (b) =>
            b.driverId === activeDriver.driverId &&
            b.status !== 'cancelled' &&
            new Date(b.estimatedEndAt).getTime() >= Date.now()
        )
        .sort(
          (a, b) =>
            new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
        )
    : [];

  const liveModalConflict =
    isAssignRideOpen && activeDriver && scheduledDateTimeLocal
      ? (() => {
          const dt = new Date(scheduledDateTimeLocal);
          if (Number.isNaN(dt.getTime())) return undefined;
          return findScheduleConflict(activeDriver.driverId, dt, durationMinutes);
        })()
      : undefined;

  const filteredDrivers = driverRooms.filter(
    (d) =>
      d.driverName.toLowerCase().includes(driverSearch.trim().toLowerCase()) ||
      d.driverPhone.includes(driverSearch.trim())
  );

  // =========================================================================
  // AUTH VIEW
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
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '6px',
                }}
              >
                <label
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    color: 'var(--milo-text-muted)',
                  }}
                >
                  Phone Number
                </label>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    color:
                      phone.length === 10
                        ? 'var(--milo-success-text)'
                        : 'var(--milo-text-muted)',
                  }}
                >
                  {phone.length}/10
                </span>
              </div>
              <input
                type="tel"
                inputMode="numeric"
                pattern="\d{10}"
                maxLength={10}
                className="milo-input"
                placeholder="10-digit mobile number"
                value={phone}
                onChange={(e) => setPhone(sanitizePhoneInput(e.target.value))}
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
              disabled={isSubmittingAuth || phone.length !== 10}
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
                onClick={() => {
                  fetchMyRooms(token);
                  fetchMyBookings(token);
                }}
                disabled={loadingRooms}
                title="Refresh drivers & bookings"
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
              const driverRides = bookings
                .filter(
                  (b) =>
                    b.driverId === driver.driverId &&
                    b.status !== 'cancelled' &&
                    new Date(b.estimatedEndAt).getTime() >= Date.now()
                )
                .sort(
                  (a, b) =>
                    new Date(a.scheduledAt).getTime() -
                    new Date(b.scheduledAt).getTime()
                );

              const queryRide = driverRides.find(
                (r) => r.status === 'query_raised'
              );
              const highlightRide = queryRide || driverRides[0];
              const badge = highlightRide
                ? getBookingBadgeStyle(highlightRide.status)
                : null;

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
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '6px',
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: '0.9rem',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {driver.driverName}
                      </span>
                      {badge && (
                        <span
                          style={{
                            backgroundColor: badge.bg,
                            color: badge.color,
                            padding: '1px 6px',
                            borderRadius: '5px',
                            fontSize: '0.62rem',
                            fontWeight: 800,
                            flexShrink: 0,
                          }}
                        >
                          {badge.label}
                        </span>
                      )}
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
                  : activeDriver?.driverName.charAt(0).toUpperCase() || 'D'}
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

          {!isCommunityActive && activeDriver && (
            <button
              type="button"
              onClick={openAssignRideModal}
              className="milo-btn-primary"
              style={{
                padding: '9px 16px',
                borderRadius: '12px',
                fontSize: '0.84rem',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span>⚡</span>
              <span>Assign Ride</span>
            </button>
          )}
        </header>

        {/* Upcoming Rides Queue with Reallocate & Cancel Actions */}
        {!isCommunityActive &&
          activeDriver &&
          activeDriverUpcomingBookings.length > 0 && (
            <div
              style={{
                padding: '12px 24px',
                backgroundColor: 'var(--milo-card)',
                borderBottom: '1px solid var(--milo-border)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    letterSpacing: '0.06em',
                    color: 'var(--milo-text-muted)',
                  }}
                >
                  UPCOMING RIDES ({activeDriverUpcomingBookings.length}) • EARLIEST FIRST
                </span>

                <button
                  type="button"
                  onClick={openAssignRideModal}
                  style={{
                    padding: '5px 11px',
                    borderRadius: '9px',
                    border: '1px solid var(--milo-border)',
                    backgroundColor: 'var(--milo-input)',
                    color: 'var(--milo-text)',
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  + Schedule Ride
                </button>
              </div>

              <div
                className="milo-scroll"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  maxHeight: '168px',
                  overflowY: 'auto',
                }}
              >
                {activeDriverUpcomingBookings.map((ride, index) => {
                  const badge = getBookingBadgeStyle(ride.status);
                  const canReallocate = driverRooms.length > 1;
                  return (
                    <div
                      key={ride._id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px',
                        padding: '9px 12px',
                        borderRadius: '10px',
                        backgroundColor: 'var(--milo-input)',
                        border:
                          ride.status === 'query_raised'
                            ? '1px solid rgba(231, 76, 60, 0.55)'
                            : index === 0
                            ? '1px solid var(--milo-burgundy-light)'
                            : '1px solid var(--milo-border)',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: '240px' }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            flexWrap: 'wrap',
                          }}
                        >
                          <span
                            style={{
                              fontSize: '0.72rem',
                              fontWeight: 800,
                              color: 'var(--milo-burgundy-light)',
                            }}
                          >
                            #{index + 1}
                          </span>
                          <span
                            style={{
                              backgroundColor: badge.bg,
                              color: badge.color,
                              border: `1px solid ${badge.border}`,
                              padding: '1px 7px',
                              borderRadius: '5px',
                              fontSize: '0.66rem',
                              fontWeight: 800,
                            }}
                          >
                            {badge.label}
                          </span>
                          <span
                            style={{
                              fontSize: '0.8rem',
                              fontWeight: 700,
                              color: 'var(--milo-text)',
                            }}
                          >
                            {ride.scheduledTime}
                          </span>
                          <span
                            style={{
                              fontSize: '0.8rem',
                              color: 'var(--milo-text-muted)',
                            }}
                          >
                            • <strong style={{ color: 'var(--milo-text)' }}>{ride.passengerName}</strong> ({ride.passengerPhone}): {ride.pickupLocation} → {ride.dropLocation}
                          </span>
                        </div>

                        {ride.status === 'query_raised' && ride.queryMessage && (
                          <div
                            style={{
                              marginTop: '4px',
                              fontSize: '0.76rem',
                              color: 'var(--milo-error-text)',
                              fontWeight: 600,
                            }}
                          >
                            Driver Query: “{ride.queryMessage}”
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => openReallocateModal(ride)}
                          disabled={!canReallocate}
                          title={
                            canReallocate
                              ? 'Reallocate ride to another driver'
                              : 'Add at least 2 drivers to reallocate rides'
                          }
                          style={{
                            padding: '5px 10px',
                            borderRadius: '8px',
                            border: '1px solid var(--milo-border)',
                            backgroundColor: 'var(--milo-card)',
                            color: canReallocate
                              ? 'var(--milo-text)'
                              : 'var(--milo-text-muted)',
                            fontSize: '0.74rem',
                            fontWeight: 600,
                            cursor: canReallocate ? 'pointer' : 'not-allowed',
                            opacity: canReallocate ? 1 : 0.55,
                          }}
                        >
                          Reallocate
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setCancelError('');
                            setRideToCancel(ride);
                          }}
                          style={{
                            padding: '5px 10px',
                            borderRadius: '8px',
                            border: '1px solid rgba(231, 76, 60, 0.35)',
                            backgroundColor: 'var(--milo-error-bg)',
                            color: 'var(--milo-error-text)',
                            fontSize: '0.74rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Cancel Ride
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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
                : `Send a direct message or schedule a ride for ${activeDriver?.driverName || 'your driver'}.`}
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
                    whiteSpace: 'pre-wrap',
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
      {/* REALLOCATE RIDE MODAL                                               */}
      {/* =================================================================== */}
      {rideToReallocate && (
        <div
          onClick={() => !reallocatingRide && setRideToReallocate(null)}
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
            onSubmit={handleConfirmReallocateRide}
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'var(--milo-card)',
              border: '1px solid var(--milo-border)',
              borderRadius: '22px',
              padding: '26px',
              width: '100%',
              maxWidth: '450px',
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
              <div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: '1.15rem',
                    fontWeight: 700,
                    color: 'var(--milo-text)',
                  }}
                >
                  Reallocate Ride
                </h3>
                <p
                  style={{
                    margin: '3px 0 0',
                    fontSize: '0.8rem',
                    color: 'var(--milo-text-muted)',
                  }}
                >
                  Reassign {rideToReallocate.passengerName} ({rideToReallocate.scheduledTime})
                </p>
              </div>
              <button
                type="button"
                onClick={() => !reallocatingRide && setRideToReallocate(null)}
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

            {reallocateError && (
              <div
                style={{
                  backgroundColor: 'var(--milo-error-bg)',
                  color: 'var(--milo-error-text)',
                  border: '1px solid rgba(231, 76, 60, 0.35)',
                  borderRadius: '12px',
                  padding: '10px 12px',
                  fontSize: '0.83rem',
                  fontWeight: 500,
                }}
              >
                {reallocateError}
              </div>
            )}

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                maxHeight: '240px',
                overflowY: 'auto',
              }}
            >
              {driverRooms
                .filter((d) => d.driverId !== rideToReallocate.driverId)
                .map((candidate) => {
                  const conflict = findScheduleConflict(
                    candidate.driverId,
                    new Date(rideToReallocate.scheduledAt),
                    rideToReallocate.durationMinutes,
                    rideToReallocate._id
                  );
                  const isBusy = Boolean(conflict);
                  const isChosen = selectedNewDriverId === candidate.driverId;

                  return (
                    <button
                      key={candidate.driverId}
                      type="button"
                      disabled={isBusy}
                      onClick={() => setSelectedNewDriverId(candidate.driverId)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '11px 14px',
                        borderRadius: '12px',
                        border: isChosen
                          ? '1.5px solid var(--milo-burgundy-light)'
                          : '1px solid var(--milo-border)',
                        backgroundColor: isChosen
                          ? 'rgba(110, 29, 61, 0.2)'
                          : 'var(--milo-input)',
                        color: 'var(--milo-text)',
                        cursor: isBusy ? 'not-allowed' : 'pointer',
                        opacity: isBusy ? 0.55 : 1,
                        textAlign: 'left',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                          {candidate.driverName}
                        </div>
                        <div
                          style={{
                            fontSize: '0.76rem',
                            color: 'var(--milo-text-muted)',
                          }}
                        >
                          {candidate.driverPhone}
                        </div>
                      </div>

                      <span
                        style={{
                          backgroundColor: isBusy
                            ? 'var(--milo-error-bg)'
                            : 'var(--milo-success-bg)',
                          color: isBusy
                            ? 'var(--milo-error-text)'
                            : 'var(--milo-success-text)',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                        }}
                      >
                        {isBusy ? 'BUSY AT THIS TIME' : 'AVAILABLE'}
                      </span>
                    </button>
                  );
                })}
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
                onClick={() => !reallocatingRide && setRideToReallocate(null)}
                disabled={reallocatingRide}
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
                Close
              </button>
              <button
                type="submit"
                disabled={reallocatingRide || !selectedNewDriverId}
                className="milo-btn-primary"
                style={{
                  padding: '10px 18px',
                  fontSize: '0.86rem',
                }}
              >
                {reallocatingRide ? 'Reallocating...' : 'Confirm Reallocation'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =================================================================== */}
      {/* CANCEL RIDE CONFIRMATION MODAL                                      */}
      {/* =================================================================== */}
      {rideToCancel && (
        <div
          onClick={() => !cancellingRide && setRideToCancel(null)}
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
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'var(--milo-card)',
              border: '1px solid var(--milo-border)',
              borderRadius: '22px',
              padding: '26px',
              width: '100%',
              maxWidth: '410px',
              boxShadow: 'var(--milo-shadow)',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
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
              Cancel Upcoming Ride?
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: '0.85rem',
                color: 'var(--milo-text-muted)',
                lineHeight: 1.45,
              }}
            >
              This will cancel the ride for{' '}
              <strong style={{ color: 'var(--milo-text)' }}>
                {rideToCancel.passengerName}
              </strong>{' '}
              at <strong>{rideToCancel.scheduledTime}</strong>, notify{' '}
              <strong>{rideToCancel.driverName || 'the driver'}</strong>, and
              free up their schedule slot.
            </p>

            {cancelError && (
              <div
                style={{
                  backgroundColor: 'var(--milo-error-bg)',
                  color: 'var(--milo-error-text)',
                  border: '1px solid rgba(231, 76, 60, 0.35)',
                  borderRadius: '12px',
                  padding: '10px 12px',
                  fontSize: '0.83rem',
                }}
              >
                {cancelError}
              </div>
            )}

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
                onClick={() => !cancellingRide && setRideToCancel(null)}
                disabled={cancellingRide}
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
                Keep Ride
              </button>
              <button
                type="button"
                onClick={handleConfirmCancelRide}
                disabled={cancellingRide}
                style={{
                  padding: '10px 18px',
                  borderRadius: '12px',
                  border: 'none',
                  backgroundColor: '#C0392B',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '0.86rem',
                  cursor: 'pointer',
                }}
              >
                {cancellingRide ? 'Cancelling...' : 'Yes, Cancel Ride'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* ASSIGN RIDE MODAL WITH CUSTOM MILO DATE & TIME PICKER               */}
      {/* =================================================================== */}
      {isAssignRideOpen && activeDriver && (
        <div
          onClick={closeAssignRideModal}
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
            onSubmit={handleAssignRideSubmit}
            onClick={(e) => e.stopPropagation()}
            className="milo-scroll"
            style={{
              backgroundColor: 'var(--milo-card)',
              border: '1px solid var(--milo-border)',
              borderRadius: '22px',
              padding: '26px',
              width: '100%',
              maxWidth: '470px',
              boxShadow: 'var(--milo-shadow)',
              display: 'flex',
              flexDirection: 'column',
              gap: '13px',
              maxHeight: '92vh',
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: '1.15rem',
                    fontWeight: 700,
                    color: 'var(--milo-text)',
                  }}
                >
                  Assign Ride to {activeDriver.driverName}
                </h3>
                <p
                  style={{
                    margin: '3px 0 0',
                    fontSize: '0.8rem',
                    color: 'var(--milo-text-muted)',
                  }}
                >
                  Select pickup date & time (present or future, zero cross-timing)
                </p>
              </div>
              <button
                type="button"
                onClick={closeAssignRideModal}
                disabled={assigningRide}
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

            {assignRideError && (
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
                {assignRideError}
              </div>
            )}

            {!assignRideError && liveModalConflict && (
              <div
                style={{
                  backgroundColor: 'var(--milo-error-bg)',
                  color: 'var(--milo-error-text)',
                  border: '1px solid rgba(231, 76, 60, 0.35)',
                  borderRadius: '12px',
                  padding: '10px 12px',
                  fontSize: '0.82rem',
                  fontWeight: 500,
                }}
              >
                Cross-timing warning: Overlaps with{' '}
                <strong>{liveModalConflict.passengerName}</strong> (
                {liveModalConflict.scheduledTime})
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    color: 'var(--milo-text-muted)',
                    marginBottom: '5px',
                  }}
                >
                  Passenger Name
                </label>
                <input
                  type="text"
                  className="milo-input"
                  placeholder="e.g. Aarav Mehta"
                  value={passengerName}
                  onChange={(e) => setPassengerName(e.target.value)}
                  required
                />
              </div>

              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '5px',
                  }}
                >
                  <label
                    style={{
                      fontSize: '0.76rem',
                      fontWeight: 600,
                      color: 'var(--milo-text-muted)',
                    }}
                  >
                    Passenger Phone
                  </label>
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 600,
                      color:
                        passengerPhone.length === 10
                          ? 'var(--milo-success-text)'
                          : 'var(--milo-text-muted)',
                    }}
                  >
                    {passengerPhone.length}/10
                  </span>
                </div>
                <input
                  type="tel"
                  inputMode="numeric"
                  pattern="\d{10}"
                  maxLength={10}
                  className="milo-input"
                  placeholder="10-digit number"
                  value={passengerPhone}
                  onChange={(e) =>
                    setPassengerPhone(sanitizePhoneInput(e.target.value))
                  }
                  required
                />
              </div>
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.76rem',
                  fontWeight: 600,
                  color: 'var(--milo-text-muted)',
                  marginBottom: '5px',
                }}
              >
                Pickup Location
              </label>
              <input
                type="text"
                className="milo-input"
                placeholder="e.g. Terminal 3, IGI Airport, New Delhi"
                value={pickupLocation}
                onChange={(e) => setPickupLocation(e.target.value)}
                required
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.76rem',
                  fontWeight: 600,
                  color: 'var(--milo-text-muted)',
                  marginBottom: '5px',
                }}
              >
                Drop Location
              </label>
              <input
                type="text"
                className="milo-input"
                placeholder="e.g. DLF Cyber Hub, Gurugram"
                value={dropLocation}
                onChange={(e) => setDropLocation(e.target.value)}
                required
              />
            </div>

            {/* Pickup Date & Time Trigger + Trip Duration */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.45fr 1fr', gap: '10px' }}>
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    color: 'var(--milo-text-muted)',
                    marginBottom: '5px',
                  }}
                >
                  Pickup Date & Time
                </label>
                <button
                  type="button"
                  onClick={() => setIsDateTimePickerOpen((prev) => !prev)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    padding: '10px 12px',
                    borderRadius: '12px',
                    border: isDateTimePickerOpen
                      ? '1.5px solid var(--milo-burgundy-light)'
                      : '1px solid var(--milo-border)',
                    backgroundColor: 'var(--milo-input)',
                    color: 'var(--milo-text)',
                    fontSize: '0.84rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {formatCompactTriggerDate(scheduledDateTimeLocal)}
                  </span>
                  <span
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '7px',
                      backgroundColor: 'rgba(110, 29, 61, 0.22)',
                      color: 'var(--milo-burgundy-light)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.78rem',
                      flexShrink: 0,
                    }}
                  >
                    📅
                  </span>
                </button>
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    color: 'var(--milo-text-muted)',
                    marginBottom: '5px',
                  }}
                >
                  Trip Duration
                </label>
                <select
                  className="milo-input"
                  value={durationMinutes}
                  onChange={(e) => {
                    setDurationMinutes(Number(e.target.value));
                    setAssignRideError('');
                  }}
                >
                  <option value={30}>30 mins</option>
                  <option value={60}>1 hour</option>
                  <option value={90}>1.5 hours</option>
                  <option value={120}>2 hours</option>
                  <option value={180}>3 hours</option>
                  <option value={240}>4 hours</option>
                </select>
              </div>
            </div>

            {/* Custom Milo-Styled Calendar & Time Picker */}
            {isDateTimePickerOpen && (
              <MiloDateTimePicker
                value={scheduledDateTimeLocal}
                min={minDateTimeLocal}
                onChange={(nextVal) => {
                  setScheduledDateTimeLocal(nextVal);
                  setAssignRideError('');
                }}
                onClose={() => setIsDateTimePickerOpen(false)}
              />
            )}

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.76rem',
                  fontWeight: 600,
                  color: 'var(--milo-text-muted)',
                  marginBottom: '5px',
                }}
              >
                Instructions / Notes (Optional)
              </label>
              <input
                type="text"
                className="milo-input"
                placeholder="e.g. Arrival Gate 4 • 2 luggage bags"
                value={rideNotes}
                onChange={(e) => setRideNotes(e.target.value)}
              />
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
                onClick={closeAssignRideModal}
                disabled={assigningRide}
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
                disabled={
                  assigningRide ||
                  passengerPhone.length !== 10 ||
                  Boolean(liveModalConflict)
                }
                className="milo-btn-primary"
                style={{
                  padding: '10px 18px',
                  fontSize: '0.86rem',
                }}
              >
                {assigningRide ? 'Dispatching...' : 'Dispatch Ride Alert'}
              </button>
            </div>
          </form>
        </div>
      )}

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
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '6px',
                }}
              >
                <label
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    color: 'var(--milo-text-muted)',
                  }}
                >
                  Driver Phone Number
                </label>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    color:
                      driverPhone.length === 10
                        ? 'var(--milo-success-text)'
                        : 'var(--milo-text-muted)',
                  }}
                >
                  {driverPhone.length}/10
                </span>
              </div>
              <input
                type="tel"
                inputMode="numeric"
                pattern="\d{10}"
                maxLength={10}
                className="milo-input"
                placeholder="10-digit mobile number"
                value={driverPhone}
                onChange={(e) =>
                  setDriverPhone(sanitizePhoneInput(e.target.value))
                }
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
                disabled={addingDriver || driverPhone.length !== 10}
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

// =============================================================================
// CUSTOM MILO-ALIGNED DATE & TIME PICKER COMPONENT
// =============================================================================
function MiloDateTimePicker({
  value,
  min,
  onChange,
  onClose,
}: {
  value: string;
  min: string;
  onChange: (nextValue: string) => void;
  onClose: () => void;
}) {
  const current = value ? new Date(value) : new Date();
  const safeCurrent = Number.isNaN(current.getTime()) ? new Date() : current;

  const minDateObj = min ? new Date(min) : new Date();
  const safeMin = Number.isNaN(minDateObj.getTime()) ? new Date() : minDateObj;

  const [viewYear, setViewYear] = useState<number>(safeCurrent.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(safeCurrent.getMonth());

  const hourListRef = useRef<HTMLDivElement | null>(null);
  const minuteListRef = useRef<HTMLDivElement | null>(null);

  const selectedYear = safeCurrent.getFullYear();
  const selectedMonth = safeCurrent.getMonth();
  const selectedDay = safeCurrent.getDate();
  const hours24 = safeCurrent.getHours();
  const selectedMinute = safeCurrent.getMinutes();
  const isPM = hours24 >= 12;
  const selectedHour12 = hours24 % 12 === 0 ? 12 : hours24 % 12;

  useEffect(() => {
    const activeHourEl = hourListRef.current?.querySelector(
      '[data-selected="true"]'
    ) as HTMLElement | null;
    if (activeHourEl && hourListRef.current) {
      hourListRef.current.scrollTop =
        activeHourEl.offsetTop - hourListRef.current.clientHeight / 2 + 16;
    }

    const activeMinEl = minuteListRef.current?.querySelector(
      '[data-selected="true"]'
    ) as HTMLElement | null;
    if (activeMinEl && minuteListRef.current) {
      minuteListRef.current.scrollTop =
        activeMinEl.offsetTop - minuteListRef.current.clientHeight / 2 + 16;
    }
  }, []);

  const commitSelection = (
    year: number,
    month: number,
    day: number,
    hour12: number,
    minute: number,
    pm: boolean
  ) => {
    let h24 = hour12 % 12;
    if (pm) h24 += 12;

    let candidate = new Date(year, month, day, h24, minute, 0, 0);
    if (candidate.getTime() < safeMin.getTime()) {
      candidate = new Date(safeMin.getTime());
    }
    onChange(toDateTimeLocalValue(candidate));
  };

  const applyQuickPreset = (offsetMinutes?: number, tomorrow9Am?: boolean) => {
    const base = new Date();
    let target: Date;
    if (tomorrow9Am) {
      target = new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate() + 1,
        9,
        0,
        0,
        0
      );
    } else {
      target = new Date(base.getTime() + (offsetMinutes || 15) * 60_000);
    }
    setViewYear(target.getFullYear());
    setViewMonth(target.getMonth());
    onChange(toDateTimeLocalValue(target));
  };

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString(
    'en-IN',
    {
      month: 'long',
      year: 'numeric',
    }
  );

  const canGoPrevMonth =
    viewYear > safeMin.getFullYear() ||
    (viewYear === safeMin.getFullYear() && viewMonth > safeMin.getMonth());

  const goPrevMonth = () => {
    if (!canGoPrevMonth) return;
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const goNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const calendarCells: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const today = new Date();
  const hours12List = Array.from({ length: 12 }, (_, i) => i + 1);
  const minutesList = Array.from({ length: 60 }, (_, i) => i);

  return (
    <div
      style={{
        backgroundColor: 'var(--milo-input)',
        border: '1px solid var(--milo-burgundy-light)',
        borderRadius: '16px',
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      {/* Quick Presets */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '6px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {[
            { label: '+15 mins', onClick: () => applyQuickPreset(15) },
            { label: '+1 hour', onClick: () => applyQuickPreset(60) },
            { label: 'Tomorrow 9 AM', onClick: () => applyQuickPreset(0, true) },
          ].map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={preset.onClick}
              style={{
                padding: '4px 10px',
                borderRadius: '999px',
                border: '1px solid var(--milo-border)',
                backgroundColor: 'var(--milo-card)',
                color: 'var(--milo-text)',
                fontSize: '0.72rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            padding: '4px 11px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: 'var(--milo-burgundy)',
            color: '#ffffff',
            fontSize: '0.73rem',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Done
        </button>
      </div>

      {/* Side-by-Side Calendar Grid & Time Columns */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.35fr 1fr',
          gap: '12px',
          alignItems: 'stretch',
        }}
      >
        {/* Left: Month Calendar */}
        <div
          style={{
            backgroundColor: 'var(--milo-card)',
            border: '1px solid var(--milo-border)',
            borderRadius: '12px',
            padding: '10px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '8px',
            }}
          >
            <span
              style={{
                fontSize: '0.8rem',
                fontWeight: 700,
                color: 'var(--milo-text)',
              }}
            >
              {monthLabel}
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                type="button"
                onClick={goPrevMonth}
                disabled={!canGoPrevMonth}
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '7px',
                  border: '1px solid var(--milo-border)',
                  backgroundColor: 'var(--milo-input)',
                  color: canGoPrevMonth
                    ? 'var(--milo-text)'
                    : 'var(--milo-text-muted)',
                  opacity: canGoPrevMonth ? 1 : 0.4,
                  cursor: canGoPrevMonth ? 'pointer' : 'not-allowed',
                  fontSize: '0.78rem',
                }}
              >
                ‹
              </button>
              <button
                type="button"
                onClick={goNextMonth}
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '7px',
                  border: '1px solid var(--milo-border)',
                  backgroundColor: 'var(--milo-input)',
                  color: 'var(--milo-text)',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                }}
              >
                ›
              </button>
            </div>
          </div>

          {/* Weekday Labels */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              textAlign: 'center',
              marginBottom: '4px',
            }}
          >
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, idx) => (
              <span
                key={idx}
                style={{
                  fontSize: '0.67rem',
                  fontWeight: 700,
                  color: 'var(--milo-text-muted)',
                }}
              >
                {d}
              </span>
            ))}
          </div>

          {/* Day Cells */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: '2px',
            }}
          >
            {calendarCells.map((dayNum, idx) => {
              if (!dayNum) {
                return <div key={`empty-${idx}`} style={{ height: '26px' }} />;
              }

              const endOfDay = new Date(viewYear, viewMonth, dayNum, 23, 59, 59);
              const isPastDay = endOfDay.getTime() < safeMin.getTime();
              const isSelected =
                viewYear === selectedYear &&
                viewMonth === selectedMonth &&
                dayNum === selectedDay;
              const isToday =
                viewYear === today.getFullYear() &&
                viewMonth === today.getMonth() &&
                dayNum === today.getDate();

              return (
                <button
                  key={dayNum}
                  type="button"
                  disabled={isPastDay}
                  onClick={() =>
                    commitSelection(
                      viewYear,
                      viewMonth,
                      dayNum,
                      selectedHour12,
                      selectedMinute,
                      isPM
                    )
                  }
                  style={{
                    height: '26px',
                    borderRadius: '7px',
                    border:
                      isToday && !isSelected
                        ? '1px solid var(--milo-burgundy-light)'
                        : '1px solid transparent',
                    backgroundColor: isSelected
                      ? 'var(--milo-burgundy)'
                      : 'transparent',
                    color: isSelected
                      ? '#ffffff'
                      : isPastDay
                      ? 'var(--milo-text-muted)'
                      : 'var(--milo-text)',
                    opacity: isPastDay ? 0.35 : 1,
                    fontSize: '0.74rem',
                    fontWeight: isSelected || isToday ? 700 : 500,
                    cursor: isPastDay ? 'not-allowed' : 'pointer',
                    padding: 0,
                  }}
                >
                  {dayNum}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Hour / Minute / AM-PM Columns */}
        <div
          style={{
            backgroundColor: 'var(--milo-card)',
            border: '1px solid var(--milo-border)',
            borderRadius: '12px',
            padding: '10px 8px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              textAlign: 'center',
              fontSize: '0.65rem',
              fontWeight: 700,
              color: 'var(--milo-text-muted)',
              marginBottom: '6px',
            }}
          >
            <span>HR</span>
            <span>MIN</span>
            <span>AM/PM</span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: '4px',
              height: '164px',
            }}
          >
            {/* Hours */}
            <div
              ref={hourListRef}
              className="milo-scroll"
              style={{
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
                position: 'relative',
              }}
            >
              {hours12List.map((hr) => {
                const active = hr === selectedHour12;
                return (
                  <button
                    key={hr}
                    type="button"
                    data-selected={active}
                    onClick={() =>
                      commitSelection(
                        selectedYear,
                        selectedMonth,
                        selectedDay,
                        hr,
                        selectedMinute,
                        isPM
                      )
                    }
                    style={{
                      padding: '5px 0',
                      borderRadius: '7px',
                      border: 'none',
                      backgroundColor: active
                        ? 'var(--milo-burgundy)'
                        : 'transparent',
                      color: active ? '#ffffff' : 'var(--milo-text)',
                      fontSize: '0.76rem',
                      fontWeight: active ? 700 : 500,
                      cursor: 'pointer',
                    }}
                  >
                    {String(hr).padStart(2, '0')}
                  </button>
                );
              })}
            </div>

            {/* Minutes */}
            <div
              ref={minuteListRef}
              className="milo-scroll"
              style={{
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
                position: 'relative',
              }}
            >
              {minutesList.map((minVal) => {
                const active = minVal === selectedMinute;
                return (
                  <button
                    key={minVal}
                    type="button"
                    data-selected={active}
                    onClick={() =>
                      commitSelection(
                        selectedYear,
                        selectedMonth,
                        selectedDay,
                        selectedHour12,
                        minVal,
                        isPM
                      )
                    }
                    style={{
                      padding: '5px 0',
                      borderRadius: '7px',
                      border: 'none',
                      backgroundColor: active
                        ? 'var(--milo-burgundy)'
                        : 'transparent',
                      color: active ? '#ffffff' : 'var(--milo-text)',
                      fontSize: '0.76rem',
                      fontWeight: active ? 700 : 500,
                      cursor: 'pointer',
                    }}
                  >
                    {String(minVal).padStart(2, '0')}
                  </button>
                );
              })}
            </div>

            {/* AM / PM */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              {[false, true].map((pmOption) => {
                const active = isPM === pmOption;
                return (
                  <button
                    key={pmOption ? 'PM' : 'AM'}
                    type="button"
                    onClick={() =>
                      commitSelection(
                        selectedYear,
                        selectedMonth,
                        selectedDay,
                        selectedHour12,
                        selectedMinute,
                        pmOption
                      )
                    }
                    style={{
                      padding: '8px 0',
                      borderRadius: '8px',
                      border: active
                        ? 'none'
                        : '1px solid var(--milo-border)',
                      backgroundColor: active
                        ? 'var(--milo-burgundy)'
                        : 'var(--milo-input)',
                      color: active ? '#ffffff' : 'var(--milo-text)',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {pmOption ? 'PM' : 'AM'}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

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