"use client";

import { useEffect, useRef, useState, useCallback, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack } from "livekit-client";
import { createClient } from "@/utils/supabase/client";
import {
  MessageSquare,
  Send,
  Paperclip,
  LogOut,
  UserPlus,
  Search,
  X,
  Check,
  FileText,
  Loader2,
  Clock,
  Users,
  Inbox,
  Settings,
  Plus,
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
} from "lucide-react";

type Profile = {
  id: string;
  username: string;
  email?: string | null;
  avatar_url: string | null;
  pronouns?: string | null;
  bio?: string | null;
  status?: "online" | "idle" | "dnd" | "offline";
  status_message?: string | null;
  last_seen?: string | null;
};

type Message = {
  id: string;
  sender_id: string;
  sender_name?: string;
  receiver_id: string | null;
  group_id?: string | null;
  content: string | null;
  file_url: string | null;
  file_name: string | null;
  file_type: string | null;
  created_at: string;
};

type GroupChat = {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
};

type Conversation = { type: "dm"; profile: Profile } | { type: "group"; group: GroupChat; members: Profile[] };

type GroupMemberRow = {
  group_id: string;
  profile_id: string;
};

type CallStatus = "ringing" | "active" | "ended" | "declined";

type CallRow = {
  id: string;
  room_name: string;
  caller_id: string;
  caller_name: string;
  receiver_id: string | null;
  group_id: string | null;
  status: CallStatus;
  created_at: string;
  ended_at?: string | null;
};

type LiveKitTokenResponse = {
  token: string;
  expiresAt: string;
  identity: string;
};

type IncomingRequest = {
  requestRowId: string;
  profile: Profile;
};

type OutgoingRequest = {
  requestRowId: string;
  profile: Profile;
};

type ContextMenuState = {
  id: string;
  x: number;
  y: number;
};

type ReplyTarget = {
  id: string;
  senderName: string;
  text: string | null;
  fileName: string | null;
};

type MessagePayload = {
  text: string;
  reply: ReplyTarget | null;
  reactions: Record<string, string[]>;
  deleted: boolean;
  embedUrl: string | null;
};

export default function ChatClient({
  currentUser,
  currentProfile,
  friends: initialFriends,
  incomingRequests: initialRequests,
  outgoingRequests: initialOutgoing,
}: {
  currentUser: { id: string; email: string };
  currentProfile: Profile | null;
  friends: Profile[];
  incomingRequests: IncomingRequest[];
  outgoingRequests: OutgoingRequest[];
}) {
  const supabase = createClient();
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(currentProfile);
  const [friends, setFriends] = useState<Profile[]>(initialFriends);
  const [requests, setRequests] = useState<IncomingRequest[]>(initialRequests);
  const [outgoing, setOutgoing] = useState<OutgoingRequest[]>(initialOutgoing);
  const [groupChats, setGroupChats] = useState<GroupChat[]>([]);
  const [groupMembers, setGroupMembers] = useState<Record<string, Profile[]>>({});
  const [sidebarTab, setSidebarTab] = useState<"chats" | "requests">("chats");
  const [selected, setSelected] = useState<Conversation | null>(initialFriends[0] ? { type: "dm", profile: initialFriends[0] } : null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupNameInput, setGroupNameInput] = useState("");
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [addFriendMsg, setAddFriendMsg] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [usernameInput, setUsernameInput] = useState(currentProfile?.username ?? "");
  const [pronounsInput, setPronounsInput] = useState(currentProfile?.pronouns ?? "");
  const [bioInput, setBioInput] = useState(currentProfile?.bio ?? "");
  const [statusInput, setStatusInput] = useState<Profile["status"]>(currentProfile?.status ?? "online");
  const [statusMessageInput, setStatusMessageInput] = useState(currentProfile?.status_message ?? "");
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [profilePanelOpen, setProfilePanelOpen] = useState(false);
  const [liveKitToken, setLiveKitToken] = useState<string | null>(null);
  const [activeCall, setActiveCall] = useState<CallRow | null>(null);
  const [incomingCall, setIncomingCall] = useState<CallRow | null>(null);
  const [callConnected, setCallConnected] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [remoteParticipants, setRemoteParticipants] = useState<string[]>([]);
  const inactivityTimerRef = useRef<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const localVideoRef = useRef<HTMLDivElement>(null);
  const remoteMediaRef = useRef<HTMLDivElement>(null);
  const liveKitRoomRef = useRef<Room | null>(null);
  const notificationSoundRef = useRef<HTMLAudioElement | null>(null);
  const incomingRingRef = useRef<HTMLAudioElement | null>(null);
  const soundUnlockedRef = useRef(false);
  const pendingSoundRef = useRef(false);
  const selectedTitle = selected ? conversationTitle(selected) : "";
  const selectedSubtitle = selected ? conversationSubtitle(selected) : "";
  const liveKitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("nebula-theme") as "dark" | "light" | null;
    if (storedTheme) {
      setTheme(storedTheme);
    }

    if (typeof window !== "undefined") {
      const audio = new Audio("https://github.com/lefuturiste/discord-sounds/raw/refs/heads/master/new-message.mp3");
      audio.preload = "auto";
      audio.volume = 0.9;
      notificationSoundRef.current = audio;

      const incomingRing = new Audio("https://github.com/lefuturiste/discord-sounds/raw/refs/heads/master/incoming-ring.mp3");
      incomingRing.preload = "auto";
      incomingRing.loop = true;
      incomingRing.volume = 0.85;
      incomingRingRef.current = incomingRing;

      const unlockAudio = () => {
        if (soundUnlockedRef.current) return;
        soundUnlockedRef.current = true;
        if (pendingSoundRef.current && notificationSoundRef.current) {
          pendingSoundRef.current = false;
          notificationSoundRef.current.currentTime = 0;
          void notificationSoundRef.current.play().catch(() => undefined);
        }
      };

      window.addEventListener("pointerdown", unlockAudio, { passive: true });
      window.addEventListener("keydown", unlockAudio, { passive: true });

      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => undefined);
      }

      return () => {
        window.removeEventListener("pointerdown", unlockAudio);
        window.removeEventListener("keydown", unlockAudio);
      };
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem("nebula-theme", theme);
  }, [theme]);

  useEffect(() => {
    const loadLiveKitToken = async () => {
      const response = await fetch("/api/livekit/token", { method: "POST" });
      if (!response.ok) return;
      const data = (await response.json()) as LiveKitTokenResponse;
      setLiveKitToken(data.token);
    };

    void loadLiveKitToken();
  }, []);

  const updatePresence = useCallback(
    async (status: Profile["status"] = "online") => {
      if (!profile?.id) return;
      if (status === "online" && profile.status && !["online", "idle"].includes(profile.status)) return;
      const { error } = await supabase
        .from("profiles")
        .update({
          status,
          last_seen: new Date().toISOString(),
        })
        .eq("id", profile.id);

      if (error && /column|does not exist/i.test(error.message)) {
        return;
      }
    },
    [profile?.id, supabase]
  );

  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) {
      window.clearTimeout(inactivityTimerRef.current);
    }
    inactivityTimerRef.current = window.setTimeout(() => {
      void updatePresence("idle");
    }, 5 * 60 * 1000);
  }, [updatePresence]);

  useEffect(() => {
    if (!profile?.id) return;

    const handleActivity = () => {
      void updatePresence("online");
      resetInactivityTimer();
    };

    void updatePresence("online");
    resetInactivityTimer();

    window.addEventListener("mousemove", handleActivity);
    window.addEventListener("keydown", handleActivity);
    window.addEventListener("click", handleActivity);
    window.addEventListener("scroll", handleActivity, { passive: true });

    return () => {
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("click", handleActivity);
      window.removeEventListener("scroll", handleActivity);
      if (inactivityTimerRef.current) {
        window.clearTimeout(inactivityTimerRef.current);
      }
    };
  }, [profile?.id, resetInactivityTimer, updatePresence]);

  // Reset settings inputs only when settings modal opens
  useEffect(() => {
    if (settingsOpen && profile) {
      setUsernameInput(profile.username ?? "");
      setPronounsInput(profile.pronouns ?? "");
      setBioInput(profile.bio ?? "");
      setStatusInput(profile.status ?? "online");
      setStatusMessageInput(profile.status_message ?? "");
    }
  }, [settingsOpen, profile?.id]);

  useEffect(() => {
    if (!currentUser.id || profile) return;

    const ensureProfile = async () => {
      const fallbackUsername = currentProfile?.username ?? currentUser.email.split("@")[0] ?? "user";
      const { data: createdProfile } = await supabase
        .from("profiles")
        .upsert({
          id: currentUser.id,
          username: fallbackUsername,
          status: "online",
          last_seen: new Date().toISOString(),
        })
        .select()
        .single();

      if (createdProfile) {
        setProfile(createdProfile as Profile);
      }
    };

    void ensureProfile();
  }, [currentProfile?.username, currentUser.email, currentUser.id, profile, supabase]);

  const loadGroupById = useCallback(
    async (groupId: string) => {
      const { data: group } = await supabase.from("group_chats").select("*").eq("id", groupId).maybeSingle();
      if (!group) return;

      const { data: memberRows } = await supabase.from("group_members").select("profile_id").eq("group_id", groupId);
      const memberIds = (memberRows ?? []).map((row) => row.profile_id);
      const { data: memberProfiles } =
        memberIds.length > 0 ? await supabase.from("profiles").select("*").in("id", memberIds) : { data: [] };

      setGroupChats((prev) => (prev.some((item) => item.id === group.id) ? prev : [...prev, group as GroupChat]));
      setGroupMembers((prev) => ({ ...prev, [group.id]: (memberProfiles ?? []) as Profile[] }));
    },
    [supabase]
  );

  useEffect(() => {
    const loadGroups = async () => {
      const { data: memberships } = await supabase
        .from("group_members")
        .select("group_id, profile_id")
        .eq("profile_id", currentUser.id);

      const groupIds = Array.from(new Set((memberships ?? []).map((row) => row.group_id)));
      if (groupIds.length === 0) {
        setGroupChats([]);
        setGroupMembers({});
        return;
      }

      const [{ data: groups }, { data: memberRows }] = await Promise.all([
        supabase.from("group_chats").select("*").in("id", groupIds).order("created_at", { ascending: false }),
        supabase.from("group_members").select("group_id, profile_id").in("group_id", groupIds),
      ]);

      const memberIds = Array.from(new Set(((memberRows ?? []) as GroupMemberRow[]).map((row) => row.profile_id)));
      const { data: memberProfiles } =
        memberIds.length > 0 ? await supabase.from("profiles").select("*").in("id", memberIds) : { data: [] };
      const profilesById = new Map((memberProfiles ?? []).map((member) => [member.id, member as Profile]));
      const nextMembers: Record<string, Profile[]> = {};

      ((memberRows ?? []) as GroupMemberRow[]).forEach((row) => {
        const member = profilesById.get(row.profile_id);
        if (!member) return;
        nextMembers[row.group_id] = [...(nextMembers[row.group_id] ?? []), member];
      });

      setGroupChats((groups ?? []) as GroupChat[]);
      setGroupMembers(nextMembers);
    };

    void loadGroups();
  }, [currentUser.id, supabase]);

  useEffect(() => {
    if (!selected) {
      setMessages([]);
      return;
    }
    setLoadingMsgs(true);
    const query =
      selected.type === "dm"
        ? supabase
            .from("messages")
            .select("*")
            .or(
              `and(sender_id.eq.${currentUser.id},receiver_id.eq.${selected.profile.id}),and(sender_id.eq.${selected.profile.id},receiver_id.eq.${currentUser.id})`
            )
        : supabase.from("messages").select("*").eq("group_id", selected.group.id);

    query.order("created_at", { ascending: true }).then(({ data }) => {
      setMessages(data ?? []);
      setLoadingMsgs(false);
    });
  }, [selected, currentUser.id, supabase]);

  const notifyIncomingMessage = useCallback(
    (msg: Message) => {
      if (msg.sender_id === currentUser.id) return;

      const parsed = parseMessageContent(msg.content);
      const groupSender = msg.group_id ? groupMembers[msg.group_id]?.find((member) => member.id === msg.sender_id) : null;
      const sender = friends.find((friend) => friend.id === msg.sender_id) ?? groupSender;
      const senderName = sender?.username ?? "Someone";
      const body = parsed.text || (msg.file_name ? `Sent a file: ${msg.file_name}` : "New message");
      const shouldNotify =
        document.hidden ||
        !selected ||
        (selected.type === "dm" && selected.profile.id !== msg.sender_id) ||
        (selected.type === "group" && selected.group.id !== msg.group_id);

      if (shouldNotify) {
        if (!soundUnlockedRef.current) {
          pendingSoundRef.current = true;
        } else if (notificationSoundRef.current) {
          notificationSoundRef.current.currentTime = 0;
          void notificationSoundRef.current.play().catch(() => undefined);
        }

        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
          const groupName = msg.group_id ? groupChats.find((group) => group.id === msg.group_id)?.name : null;
          new Notification(groupName ? `${senderName} in ${groupName}` : `New message from ${senderName}`, {
            body,
            tag: msg.id,
          });
        }
      }
    },
    [currentUser.id, friends, groupChats, groupMembers, selected]
  );

  useEffect(() => {
    const messagesChannel = supabase
      .channel("messages-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as Message;
          const involvesMe =
            msg.sender_id === currentUser.id ||
            msg.receiver_id === currentUser.id ||
            Boolean(msg.group_id && groupMembers[msg.group_id]);
          if (!involvesMe) return;

          setSelected((sel) => {
            if (
              sel &&
              ((sel.type === "dm" &&
                ((msg.sender_id === sel.profile.id && msg.receiver_id === currentUser.id) ||
                  (msg.receiver_id === sel.profile.id && msg.sender_id === currentUser.id))) ||
                (sel.type === "group" && msg.group_id === sel.group.id))
            ) {
              setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
            }
            return sel;
          });

          if (msg.sender_id !== currentUser.id) {
            notifyIncomingMessage(msg);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as Message;
          setMessages((prev) => prev.map((item) => (item.id === msg.id ? msg : item)));
        }
      )
      .subscribe();

    const profilesChannel = supabase
      .channel("profiles-realtime")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        (payload) => {
          const updatedProfile = payload.new as Profile;
          setProfile((prev) => (prev?.id === updatedProfile.id ? { ...prev, ...updatedProfile } : prev));
          setFriends((prev) => prev.map((friend) => (friend.id === updatedProfile.id ? { ...friend, ...updatedProfile } : friend)));
          setRequests((prev) => prev.map((request) => (request.profile.id === updatedProfile.id ? { ...request, profile: { ...request.profile, ...updatedProfile } } : request)));
          setOutgoing((prev) => prev.map((request) => (request.profile.id === updatedProfile.id ? { ...request, profile: { ...request.profile, ...updatedProfile } } : request)));
          setGroupMembers((prev) => {
            const next = { ...prev };
            Object.entries(next).forEach(([groupId, members]) => {
              next[groupId] = members.map((member) => (member.id === updatedProfile.id ? { ...member, ...updatedProfile } : member));
            });
            return next;
          });
          setSelected((prev) =>
            prev?.type === "dm" && prev.profile.id === updatedProfile.id
              ? { type: "dm", profile: { ...prev.profile, ...updatedProfile } }
              : prev?.type === "group"
                ? {
                    ...prev,
                    members: prev.members.map((member) => (member.id === updatedProfile.id ? { ...member, ...updatedProfile } : member)),
                  }
                : prev
          );
        }
      )
      .subscribe();

    const groupMembersChannel = supabase
      .channel(`group-members-${currentUser.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "group_members", filter: `profile_id=eq.${currentUser.id}` },
        (payload) => {
          const row = payload.new as GroupMemberRow;
          void loadGroupById(row.group_id);
        }
      )
      .subscribe();

    const callsChannel = supabase
      .channel(`calls-${currentUser.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "calls" },
        (payload) => {
          const call = payload.new as CallRow;
          const targetsMe =
            call.caller_id !== currentUser.id &&
            (call.receiver_id === currentUser.id || Boolean(call.group_id && groupMembers[call.group_id]));
          if (!targetsMe || call.status !== "ringing") return;

          setIncomingCall(call);
          void incomingRingRef.current?.play().catch(() => undefined);

          if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
            const groupName = call.group_id ? groupChats.find((group) => group.id === call.group_id)?.name : null;
            new Notification(groupName ? `${call.caller_name} is calling ${groupName}` : `${call.caller_name} is calling you`, {
              body: "Incoming Nebula call",
              tag: call.id,
            });
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "calls" },
        (payload) => {
          const call = payload.new as CallRow;
          if (!["ended", "declined"].includes(call.status)) return;
          setIncomingCall((prev) => (prev?.id === call.id ? null : prev));
          setActiveCall((prev) => {
            if (prev?.id !== call.id) return prev;
            liveKitRoomRef.current?.disconnect();
            liveKitRoomRef.current = null;
            cleanupCallMedia();
            return null;
          });
          stopIncomingRing();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messagesChannel);
      supabase.removeChannel(profilesChannel);
      supabase.removeChannel(groupMembersChannel);
      supabase.removeChannel(callsChannel);
    };
  }, [supabase, currentUser.id, notifyIncomingMessage, groupMembers, groupChats, loadGroupById]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(
    async (fileUrl?: string, fileName?: string, fileType?: string) => {
      if (!selected) return;
      if (!text.trim() && !fileUrl) return;

      const payload: MessagePayload = {
        text: text.trim(),
        reply: replyTarget
          ? {
              id: replyTarget.id,
              senderName: replyTarget.senderName,
              text: replyTarget.text,
              fileName: replyTarget.fileName,
            }
          : null,
        reactions: {},
        deleted: false,
        embedUrl: extractUrl(text.trim()),
      };

      const { data, error } = await supabase
        .from("messages")
        .insert({
          sender_id: currentUser.id,
          sender_name: profile?.username ?? currentUser.email,
          receiver_id: selected.type === "dm" ? selected.profile.id : null,
          group_id: selected.type === "group" ? selected.group.id : null,
          content: serializeMessagePayload(payload),
          file_url: fileUrl ?? null,
          file_name: fileName ?? null,
          file_type: fileType ?? null,
        })
        .select()
        .single();

      if (!error && data) {
        setMessages((prev) => [...prev, data as Message]);
        setText("");
        setReplyTarget(null);
      }
    },
    [selected, text, replyTarget, supabase, currentUser.id, currentUser.email, profile?.username]
  );

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selected) return;

    setUploading(true);
    const path = `${currentUser.id}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("chat-files").upload(path, file);

    if (uploadError) {
      setUploading(false);
      alert("Upload failed: " + uploadError.message);
      return;
    }

    const { data: publicUrl } = supabase.storage.from("chat-files").getPublicUrl(path);
    await sendMessage(publicUrl.publicUrl, file.name, file.type);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const path = `avatars/${currentUser.id}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("chat-files").upload(path, file);
    if (uploadError) {
      alert("Avatar upload failed: " + uploadError.message);
      return;
    }

    const { data: publicUrl } = supabase.storage.from("chat-files").getPublicUrl(path);
    const avatarUrl = publicUrl.publicUrl;
    const { data: updatedProfile } = await supabase
      .from("profiles")
      .upsert({ id: currentUser.id, username: profile?.username ?? usernameInput, avatar_url: avatarUrl })
      .select()
      .single();

    if (updatedProfile) {
      setProfile(updatedProfile as Profile);
    }

    if (avatarInputRef.current) avatarInputRef.current.value = "";
  };

  const saveProfileSettings = async () => {
    const nextUsername = usernameInput.trim() || (profile?.username ?? currentUser.email.split("@")[0]);
    const payload = {
      id: currentUser.id,
      username: nextUsername,
      avatar_url: profile?.avatar_url ?? null,
      pronouns: pronounsInput.trim() || null,
      bio: bioInput.trim() || null,
      status: statusInput,
      status_message: statusMessageInput.trim() || null,
      last_seen: new Date().toISOString(),
    };

    const { data: updatedProfile, error } = await supabase.from("profiles").upsert(payload).select().single();

    if (error) {
      if (/column|does not exist/i.test(error.message)) {
        const { data: fallbackProfile, error: fallbackError } = await supabase
          .from("profiles")
          .upsert({
            id: currentUser.id,
            username: nextUsername,
            avatar_url: profile?.avatar_url ?? null,
          })
          .select()
          .single();

        if (fallbackError) {
          alert(`Couldn't save profile changes: ${fallbackError.message}`);
          return;
        }

        if (fallbackProfile) {
          const nextProfile = fallbackProfile as Profile;
          setProfile(nextProfile);
          setFriends((prev) => prev.map((friend) => (friend.id === currentUser.id ? { ...friend, ...nextProfile } : friend)));
          setRequests((prev) => prev.map((request) => (request.profile.id === currentUser.id ? { ...request, profile: { ...request.profile, ...nextProfile } } : request)));
          setOutgoing((prev) => prev.map((request) => (request.profile.id === currentUser.id ? { ...request, profile: { ...request.profile, ...nextProfile } } : request)));
          await updatePresence(statusInput);
          setSettingsOpen(false);
        }
        return;
      }

      alert(`Couldn't save profile changes: ${error.message}`);
      return;
    }

    if (updatedProfile) {
      const nextProfile = updatedProfile as Profile;
      setProfile(nextProfile);
      setFriends((prev) => prev.map((friend) => (friend.id === currentUser.id ? { ...friend, ...nextProfile } : friend)));
      setRequests((prev) => prev.map((request) => (request.profile.id === currentUser.id ? { ...request, profile: { ...request.profile, ...nextProfile } } : request)));
      setOutgoing((prev) => prev.map((request) => (request.profile.id === currentUser.id ? { ...request, profile: { ...request.profile, ...nextProfile } } : request)));
      await updatePresence(statusInput);
      setSettingsOpen(false);
    }
  };

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    setAddFriendMsg(null);
    if (q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .ilike("email", `%${q}%`)
      .neq("id", currentUser.id)
      .limit(8);

    const excludeIds = new Set([
      ...friends.map((f) => f.id),
      ...requests.map((r) => r.profile.id),
      ...outgoing.map((r) => r.profile.id),
    ]);
    setSearchResults((data ?? []).filter((p) => !excludeIds.has(p.id)));
    setSearching(false);
  };

  const sendFriendRequest = async (profileToAdd: Profile) => {
    const { data, error } = await supabase.rpc("create_friend_request", {
      requester_id: currentUser.id,
      recipient_id: profileToAdd.id,
    });

    if (error) {
      setAddFriendMsg(error.message.includes("duplicate") ? "Request already sent." : error.message);
      return;
    }

    setAddFriendMsg(`Friend request sent to ${profileToAdd.username}.`);
    setOutgoing((prev) => [...prev, { requestRowId: data as string, profile: profileToAdd }]);
    setSearchResults((prev) => prev.filter((p) => p.id !== profileToAdd.id));
  };

  const acceptRequest = async (req: IncomingRequest) => {
    await supabase.from("friends").update({ status: "accepted" }).eq("id", req.requestRowId);
    setRequests((prev) => prev.filter((r) => r.requestRowId !== req.requestRowId));
    setFriends((prev) => [...prev, req.profile]);
  };

  const declineRequest = async (req: IncomingRequest) => {
    await supabase.from("friends").delete().eq("id", req.requestRowId);
    setRequests((prev) => prev.filter((r) => r.requestRowId !== req.requestRowId));
  };

  const cancelRequest = async (req: OutgoingRequest) => {
    await supabase.from("friends").delete().eq("id", req.requestRowId);
    setOutgoing((prev) => prev.filter((r) => r.requestRowId !== req.requestRowId));
  };

  const createGroupChat = async () => {
    const memberIds = Array.from(selectedGroupMembers);
    if (memberIds.length === 0) return;

    const members = friends.filter((friend) => memberIds.includes(friend.id));
    const fallbackName = members.map((member) => member.username).join(", ");
    const groupName = groupNameInput.trim() || fallbackName || "New group";

    const { data: group, error: groupError } = await supabase
      .from("group_chats")
      .insert({ name: groupName, created_by: currentUser.id })
      .select()
      .single();

    if (groupError || !group) {
      alert(`Couldn't create group chat: ${groupError?.message ?? "Unknown error"}`);
      return;
    }

    const rows = [currentUser.id, ...memberIds].map((profileId) => ({
      group_id: group.id,
      profile_id: profileId,
    }));
    const { error: memberError } = await supabase.from("group_members").insert(rows);

    if (memberError) {
      alert(`Group was created, but members could not be added: ${memberError.message}`);
      return;
    }

    const currentMember = profile ? [profile] : [];
    const nextGroup = group as GroupChat;
    const nextMembers = [...currentMember, ...members];
    setGroupChats((prev) => [nextGroup, ...prev]);
    setGroupMembers((prev) => ({ ...prev, [nextGroup.id]: nextMembers }));
    setSelected({ type: "group", group: nextGroup, members: nextMembers });
    setShowCreateGroup(false);
    setGroupNameInput("");
    setSelectedGroupMembers(new Set());
    setSidebarTab("chats");
  };

  const attachRemoteTrack = (track: RemoteTrack, participant: RemoteParticipant) => {
    const container = remoteMediaRef.current;
    if (!container) return;

    const element = track.attach();
    element.setAttribute("data-participant", participant.identity);
    element.className =
      track.kind === Track.Kind.Video
        ? "h-40 w-full rounded-xl bg-bg object-cover"
        : "hidden";
    container.appendChild(element);
  };

  const cleanupCallMedia = () => {
    remoteMediaRef.current?.replaceChildren();
    localVideoRef.current?.replaceChildren();
    setRemoteParticipants([]);
    setCallConnected(false);
    setMicEnabled(true);
    setCameraEnabled(false);
  };

  const stopIncomingRing = () => {
    if (!incomingRingRef.current) return;
    incomingRingRef.current.pause();
    incomingRingRef.current.currentTime = 0;
  };

  const connectToLiveKitCall = async (call: CallRow) => {
    if (!liveKitUrl) {
      setCallError("LiveKit is not ready yet.");
      return;
    }

    setCallError(null);
    stopIncomingRing();
    cleanupCallMedia();

    const existingRoom = liveKitRoomRef.current;
    if (existingRoom) {
      existingRoom.disconnect();
    }

    const room = new Room();
    liveKitRoomRef.current = room;

    room
      .on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        attachRemoteTrack(track, participant);
        setRemoteParticipants(Array.from(room.remoteParticipants.values()).map((item) => item.identity));
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((element) => element.remove());
      })
      .on(RoomEvent.ParticipantConnected, () => {
        setRemoteParticipants(Array.from(room.remoteParticipants.values()).map((item) => item.identity));
      })
      .on(RoomEvent.ParticipantDisconnected, () => {
        setRemoteParticipants(Array.from(room.remoteParticipants.values()).map((item) => item.identity));
      })
      .on(RoomEvent.Disconnected, cleanupCallMedia);

    try {
      const tokenResponse = await fetch("/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomName: call.room_name }),
      });
      if (!tokenResponse.ok) {
        throw new Error("Could not generate a LiveKit call token.");
      }
      const tokenData = (await tokenResponse.json()) as LiveKitTokenResponse;
      setLiveKitToken(tokenData.token);
      await room.connect(liveKitUrl, tokenData.token);
      await room.localParticipant.setMicrophoneEnabled(true);
      const existingParticipants = Array.from(room.remoteParticipants.values());
      existingParticipants.forEach((participant) => {
        participant.trackPublications.forEach((publication) => {
          if (publication.track) {
            attachRemoteTrack(publication.track as RemoteTrack, participant);
          }
        });
      });
      setRemoteParticipants(existingParticipants.map((participant) => participant.identity));
      setCallConnected(true);
      setActiveCall(call);
    } catch (error) {
      setCallError(error instanceof Error ? error.message : "Could not connect to the call.");
      room.disconnect();
    }
  };

  const startCall = async () => {
    if (!selected || !profile) return;
    const callId = crypto.randomUUID();
    const call: CallRow = {
      id: callId,
      room_name: `nebula-${callId}`,
      caller_id: currentUser.id,
      caller_name: profile.username,
      receiver_id: selected.type === "dm" ? selected.profile.id : null,
      group_id: selected.type === "group" ? selected.group.id : null,
      status: "ringing",
      created_at: new Date().toISOString(),
    };

    setActiveCall(call);
    const { error } = await supabase.from("calls").insert(call);
    if (error) {
      setCallError(error.message);
      setActiveCall(null);
      return;
    }

    await connectToLiveKitCall(call);
  };

  const acceptCall = async () => {
    if (!incomingCall) return;
    await supabase.from("calls").update({ status: "active" }).eq("id", incomingCall.id);
    setIncomingCall(null);
    await connectToLiveKitCall({ ...incomingCall, status: "active" });
  };

  const declineCall = async () => {
    if (!incomingCall) return;
    stopIncomingRing();
    await supabase.from("calls").update({ status: "declined", ended_at: new Date().toISOString() }).eq("id", incomingCall.id);
    setIncomingCall(null);
  };

  const endCall = async () => {
    const call = activeCall;
    liveKitRoomRef.current?.disconnect();
    liveKitRoomRef.current = null;
    cleanupCallMedia();
    setActiveCall(null);
    stopIncomingRing();
    if (call) {
      await supabase.from("calls").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", call.id);
    }
  };

  const toggleMic = async () => {
    const next = !micEnabled;
    await liveKitRoomRef.current?.localParticipant.setMicrophoneEnabled(next);
    setMicEnabled(next);
  };

  const toggleCamera = async () => {
    const next = !cameraEnabled;
    await liveKitRoomRef.current?.localParticipant.setCameraEnabled(next);
    setCameraEnabled(next);
    localVideoRef.current?.replaceChildren();
    if (next) {
      const publication = liveKitRoomRef.current?.localParticipant.getTrackPublication(Track.Source.Camera);
      const element = publication?.track?.attach();
      if (element && localVideoRef.current) {
        element.className = "h-full w-full rounded-xl bg-bg object-cover";
        localVideoRef.current.appendChild(element);
      }
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const handleDeleteMessage = async (messageId: string) => {
    const target = messages.find((item) => item.id === messageId);
    if (!target) return;

    const parsed = parseMessageContent(target.content);
    const updatedPayload: MessagePayload = {
      ...parsed,
      deleted: true,
      text: "",
    };

    await supabase.from("messages").update({ content: serializeMessagePayload(updatedPayload) }).eq("id", messageId);
    setMessages((prev) => prev.map((item) => (item.id === messageId ? { ...item, content: serializeMessagePayload(updatedPayload) } : item)));
  };

  const handleReaction = async (messageId: string, emoji: string) => {
    const target = messages.find((item) => item.id === messageId);
    if (!target) return;

    const parsed = parseMessageContent(target.content);
    const nextReactions = { ...parsed.reactions };
    const existing = nextReactions[emoji] ?? [];
    const alreadyReacted = existing.includes(currentUser.id);
    const updatedUsers = alreadyReacted
      ? existing.filter((userId) => userId !== currentUser.id)
      : [...existing, currentUser.id];

    nextReactions[emoji] = updatedUsers;
    if (updatedUsers.length === 0) {
      delete nextReactions[emoji];
    }

    const updatedPayload: MessagePayload = {
      ...parsed,
      reactions: nextReactions,
    };

    await supabase.from("messages").update({ content: serializeMessagePayload(updatedPayload) }).eq("id", messageId);
    setMessages((prev) => prev.map((item) => (item.id === messageId ? { ...item, content: serializeMessagePayload(updatedPayload) } : item)));
  };

  const handleMessageContextMenu = (event: MouseEvent, message: Message) => {
    event.preventDefault();
    setContextMenu({ id: message.id, x: event.clientX, y: event.clientY });
  };

  const initials = (name: string) => name.slice(0, 2).toUpperCase();

  return (
    <div className="h-screen w-screen flex bg-bg text-text overflow-hidden">
      <aside className="w-[300px] shrink-0 border-r border-border flex flex-col glass overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent to-accent2 flex items-center justify-center">
              <MessageSquare size={16} className="text-white" />
            </div>
            <span className="font-bold text-sm">Nebula Chat</span>
          </div>
          <button onClick={handleLogout} title="Log out" className="text-muted hover:text-red-400 transition-colors">
            <LogOut size={17} />
          </button>
        </div>

        <div className="px-5 py-3 flex items-center gap-3 border-b border-border">
          <button onClick={() => setProfilePanelOpen((v) => !v)} className="relative w-9 h-9 rounded-full bg-gradient-to-br from-accent2 to-accent flex items-center justify-center text-xs font-bold">
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="Avatar" className="h-full w-full rounded-full object-cover" />
            ) : (
              initials(profile?.username ?? currentUser.email)
            )}
            <span className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-bg ${statusBadgeClass(profile?.status ?? "online")}`} />
          </button>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{profile?.username ?? "You"}</p>
            <p className="text-xs text-muted truncate">{currentUser.email}</p>
          </div>
        </div>

        {profilePanelOpen && profile && (
          <div className="mx-4 mt-3 rounded-2xl border border-border bg-panel2/70 p-3 space-y-3">
            <div className="flex items-center gap-3">
              <AvatarBadge src={profile.avatar_url} name={profile.username} className="w-12 h-12 rounded-full bg-gradient-to-br from-accent to-accent2 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{profile.username}</p>
                <p className="text-xs text-muted truncate">{profile.status_message || "Set a status message"}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className={`rounded-full px-2.5 py-1 font-medium ${statusPillClass(profile.status ?? "online")}`}>
                {formatPresenceLabel(profile.status ?? "online")}
              </span>
              {profile.pronouns ? <span className="rounded-full border border-border bg-bg/60 px-2.5 py-1">{profile.pronouns}</span> : null}
            </div>
            {profile.bio ? <p className="text-sm text-muted">{profile.bio}</p> : null}
            <button onClick={() => setSettingsOpen(true)} className="w-full rounded-xl border border-border bg-bg/60 px-3 py-2 text-sm hover:border-accent">
              Edit profile
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 px-4 pt-3 pb-1">
          <button
            onClick={() => setSidebarTab("chats")}
            className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg py-2 transition-colors ${
              sidebarTab === "chats"
                ? "bg-accent/15 text-accent border border-accent/30"
                : "text-muted hover:bg-panel2 border border-transparent"
            }`}
          >
            <Users size={14} />
            Chats
          </button>
          <button
            onClick={() => setSidebarTab("requests")}
            className={`relative flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg py-2 transition-colors ${
              sidebarTab === "requests"
                ? "bg-accent/15 text-accent border border-accent/30"
                : "text-muted hover:bg-panel2 border border-transparent"
            }`}
          >
            <Inbox size={14} />
            Requests
            {requests.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-accent2 text-[10px] font-bold text-bg flex items-center justify-center">
                {requests.length}
              </span>
            )}
          </button>
        </div>

        {sidebarTab === "chats" && (
          <>
            <div className="flex items-center justify-between px-5 pt-3 pb-2">
              <p className="text-xs font-semibold text-muted uppercase tracking-wide">Friends</p>
              <button onClick={() => setShowAddFriend((v) => !v)} className="text-accent2 hover:opacity-80" title="Add friend">
                <UserPlus size={16} />
              </button>
            </div>

            {showAddFriend && (
              <div className="px-4 pb-3">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    value={searchQuery}
                    onChange={(e) => handleSearch(e.target.value)}
                    placeholder="Search email..."
                    className="w-full bg-panel2 border border-border rounded-lg pl-8 pr-3 py-2 text-sm outline-none focus:border-accent"
                  />
                </div>
                {searching && <p className="text-xs text-muted mt-2">Searching...</p>}
                {addFriendMsg && <p className="text-xs text-accent2 mt-2">{addFriendMsg}</p>}
                <div className="flex flex-col gap-1.5 mt-2 max-h-40 overflow-y-auto">
                  {searchResults.map((p) => (
                    <div key={p.id} className="flex items-center justify-between bg-panel2 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <AvatarBadge
                          src={p.avatar_url}
                          name={p.username}
                          className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-accent2 shrink-0"
                        />
                        <span className="text-sm truncate">{p.username}</span>
                      </div>
                      <button onClick={() => sendFriendRequest(p)} className="text-xs bg-accent/20 text-accent px-2 py-1 rounded-md hover:bg-accent/30">
                        Add
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-3 pb-4">
              {friends.length === 0 && (
                <p className="text-xs text-muted px-2 mt-2">No friends yet. Use the + button to add someone by username.</p>
              )}
              {friends.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setSelected({ type: "dm", profile: f })}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 transition-colors ${
                    selected?.type === "dm" && selected.profile.id === f.id ? "bg-accent/15 border border-accent/30" : "hover:bg-panel2"
                  }`}
                >
                  <div className="relative">
                    <AvatarBadge
                      src={f.avatar_url}
                      name={f.username}
                      className="w-9 h-9 rounded-full bg-gradient-to-br from-accent to-accent2 shrink-0"
                    />
                    <span className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-bg ${statusBadgeClass(f.status ?? "offline")}`} />
                  </div>
                  <div className="min-w-0 text-left">
                    <span className="block text-sm font-medium truncate">{f.username}</span>
                    <span className="block text-[11px] text-muted truncate">{presenceSubtitle(f)}</span>
                  </div>
                </button>
              ))}
              {groupChats.length > 0 && (
                <p className="text-xs font-semibold text-muted uppercase tracking-wide px-2 mt-4 mb-2">Groups</p>
              )}
              {groupChats.map((group) => {
                const members = groupMembers[group.id] ?? [];
                return (
                  <button
                    key={group.id}
                    onClick={() => setSelected({ type: "group", group, members })}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 transition-colors ${
                      selected?.type === "group" && selected.group.id === group.id ? "bg-accent/15 border border-accent/30" : "hover:bg-panel2"
                    }`}
                  >
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-accent to-accent2 flex items-center justify-center text-white shrink-0">
                      <Users size={16} />
                    </div>
                    <div className="min-w-0 text-left">
                      <span className="block text-sm font-medium truncate">{group.name}</span>
                      <span className="block text-[11px] text-muted truncate">{members.length} members</span>
                    </div>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setShowCreateGroup(true)}
                className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-panel2/60 px-3 py-2.5 text-sm text-accent2 hover:border-accent2"
                title="Create group chat"
              >
                <Plus size={16} />
                Create group chat
              </button>
            </div>
          </>
        )}

        {sidebarTab === "requests" && (
          <div className="flex-1 overflow-y-auto px-4 pt-3 pb-4 flex flex-col gap-6">
            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2.5">Incoming · {requests.length}</p>
              {requests.length === 0 ? (
                <p className="text-xs text-muted bg-panel2/60 border border-border rounded-lg px-3 py-3 text-center">
                  No incoming requests right now.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {requests.map((r) => (
                    <div key={r.requestRowId} className="flex items-center justify-between bg-panel2 border border-border rounded-xl px-3 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <AvatarBadge
                          src={r.profile.avatar_url}
                          name={r.profile.username}
                          className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-accent2 shrink-0"
                        />
                        <span className="text-sm truncate">{r.profile.username}</span>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button onClick={() => acceptRequest(r)} title="Accept" className="w-7 h-7 rounded-md bg-accent2/20 text-accent2 flex items-center justify-center hover:bg-accent2/30">
                          <Check size={14} />
                        </button>
                        <button onClick={() => declineRequest(r)} title="Decline" className="w-7 h-7 rounded-md bg-red-500/15 text-red-400 flex items-center justify-center hover:bg-red-500/25">
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2.5">Sent · {outgoing.length}</p>
              {outgoing.length === 0 ? (
                <p className="text-xs text-muted bg-panel2/60 border border-border rounded-lg px-3 py-3 text-center">
                  Requests you send will show up here until they're accepted.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {outgoing.map((r) => (
                    <div key={r.requestRowId} className="flex items-center justify-between bg-panel2 border border-border rounded-xl px-3 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <AvatarBadge
                          src={r.profile.avatar_url}
                          name={r.profile.username}
                          className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-accent2 shrink-0"
                        />
                        <span className="text-sm truncate">{r.profile.username}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="flex items-center gap-1 text-[10px] font-medium text-muted bg-bg/60 border border-border rounded-full px-2 py-1">
                          <Clock size={11} />
                          Pending
                        </span>
                        <button onClick={() => cancelRequest(r)} title="Cancel request" className="w-7 h-7 rounded-md bg-red-500/15 text-red-400 flex items-center justify-center hover:bg-red-500/25">
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted gap-3">
            <MessageSquare size={40} />
            <p className="text-sm">Select a friend to start chatting</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border glass">
              <div className="flex items-center gap-3">
                <div className="relative">
                  {selected.type === "dm" ? (
                    <>
                      <AvatarBadge
                        src={selected.profile.avatar_url}
                        name={selected.profile.username}
                        className="w-9 h-9 rounded-full bg-gradient-to-br from-accent to-accent2"
                      />
                      <span className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-bg ${statusBadgeClass(selected.profile.status ?? "offline")}`} />
                    </>
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-accent to-accent2 flex items-center justify-center text-white">
                      <Users size={16} />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{selectedTitle}</p>
                  <p className="text-[11px] text-muted truncate">{selectedSubtitle}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={startCall}
                  disabled={!liveKitUrl}
                  className="rounded-full p-2 text-accent2 hover:bg-panel2 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Start call"
                >
                  <Phone size={16} />
                </button>
                <button onClick={() => setSettingsOpen(true)} className="rounded-full p-2 text-muted hover:bg-panel2" title="Settings">
                  <Settings size={16} />
                </button>
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-3">
              {loadingMsgs && (
                <div className="flex justify-center py-6 text-muted">
                  <Loader2 className="animate-spin" size={18} />
                </div>
              )}
              {!loadingMsgs && messages.length === 0 && (
                <p className="text-center text-muted text-sm mt-10">No messages yet. Say hi to {selectedTitle}</p>
              )}
              {messages.map((m) => {
                const mine = m.sender_id === currentUser.id;
                const parsed = parseMessageContent(m.content);
                const previewUrl = parsed.embedUrl ?? extractUrl(parsed.text);
                const senderName = messageSenderName(m, selected, currentUser.id);
                return (
                  <div
                    key={m.id}
                    className={`msg-in max-w-[65%] ${mine ? "self-end items-end" : "self-start items-start"} flex flex-col gap-1`}
                    onContextMenu={(event) => handleMessageContextMenu(event, m)}
                  >
                    <div
                      className={`rounded-2xl px-4 py-2.5 text-sm ${
                        mine
                          ? "bg-gradient-to-br from-accent to-accent2 text-white rounded-br-sm"
                          : "bg-panel2 border border-border rounded-bl-sm"
                      }`}
                    >
                      {selected.type === "group" && !mine && (
                        <p className="mb-1 text-[11px] font-semibold text-muted">{senderName}</p>
                      )}
                      {parsed.reply && (
                        <div className={`mb-2 rounded-xl border px-2.5 py-2 text-xs ${mine ? "border-white/20 bg-white/10" : "border-border bg-bg/40"}`}>
                          <p className="text-[10px] uppercase tracking-wide opacity-70">Replying to {parsed.reply.senderName}</p>
                          <p className="truncate">{parsed.reply.text || parsed.reply.fileName || "Attachment"}</p>
                        </div>
                      )}
                      {parsed.deleted ? (
                        <p className="italic text-xs opacity-70">This message was deleted.</p>
                      ) : (
                        <>
                          {parsed.text && <p className="whitespace-pre-wrap break-words">{parsed.text}</p>}
                          {m.file_url && (
                            <a href={m.file_url} target="_blank" rel="noreferrer" className={`flex items-center gap-2 mt-1.5 text-xs underline underline-offset-2 ${mine ? "text-white/90" : "text-accent2"}`}>
                              <FileText size={13} />
                              {m.file_name ?? "Attachment"}
                            </a>
                          )}
                          {previewUrl && (
                            <a href={previewUrl} target="_blank" rel="noreferrer" className={`mt-2 flex flex-col rounded-xl border px-3 py-2 text-xs ${mine ? "border-white/20 bg-white/10" : "border-border bg-bg/50"}`}>
                              <span className="font-semibold">{new URL(previewUrl).hostname.replace("www.", "")}</span>
                              <span className="opacity-80">{previewUrl}</span>
                            </a>
                          )}
                        </>
                      )}
                    </div>
                    {!parsed.deleted && Object.keys(parsed.reactions).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 px-1">
                        {Object.entries(parsed.reactions).map(([emoji, users]) => (
                          <button key={emoji} onClick={() => handleReaction(m.id, emoji)} className={`rounded-full border px-2 py-1 text-[11px] ${mine ? "border-white/20 bg-white/10" : "border-border bg-panel2"}`}>
                            {emoji} {users.length}
                          </button>
                        ))}
                      </div>
                    )}
                    <span className="text-[10px] text-muted px-1">{new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                );
              })}
            </div>

            {replyTarget && (
              <div className="mx-5 mb-2 flex items-center justify-between rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wide text-accent">Replying</p>
                  <p className="truncate">{replyTarget.text || replyTarget.fileName || "Attachment"}</p>
                </div>
                <button onClick={() => setReplyTarget(null)} className="text-muted hover:text-red-400">
                  <X size={15} />
                </button>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage();
              }}
              className="flex items-center gap-2 px-5 py-4 border-t border-border glass"
            >
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="w-10 h-10 shrink-0 rounded-full bg-panel2 border border-border flex items-center justify-center text-muted hover:text-accent2 hover:border-accent2 transition-colors">
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
              </button>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 bg-panel2 border border-border rounded-full px-4 py-2.5 text-sm outline-none focus:border-accent transition-colors"
              />
              <button type="submit" className="w-10 h-10 shrink-0 rounded-full bg-gradient-to-br from-accent to-accent2 flex items-center justify-center text-white hover:opacity-90 transition-opacity">
                <Send size={16} />
              </button>
            </form>
          </>
        )}
      </main>

      {incomingCall && (
        <div className="fixed bottom-5 right-5 z-50 w-[340px] rounded-3xl border border-border bg-panel p-4 shadow-2xl">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-accent to-accent2 flex items-center justify-center text-white">
              <Phone size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">{incomingCall.caller_name}</p>
              <p className="text-xs text-muted truncate">
                {incomingCall.group_id ? `Calling ${groupChats.find((group) => group.id === incomingCall.group_id)?.name ?? "this group"}` : "Incoming call"}
              </p>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={declineCall} className="flex-1 rounded-2xl bg-red-500/15 px-3 py-2.5 text-sm font-semibold text-red-400 hover:bg-red-500/25">
              Decline
            </button>
            <button onClick={acceptCall} className="flex-1 rounded-2xl bg-accent2 px-3 py-2.5 text-sm font-semibold text-bg hover:opacity-90">
              Accept
            </button>
          </div>
        </div>
      )}

      {activeCall && (
        <div className="fixed bottom-5 left-1/2 z-50 w-[min(760px,calc(100vw-32px))] -translate-x-1/2 rounded-3xl border border-border bg-panel p-4 shadow-2xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
            <div>
              <p className="text-sm font-semibold">{callTitle(activeCall, groupChats, selected)}</p>
              <p className="text-xs text-muted">
                {callConnected ? `${remoteParticipants.length + 1} connected` : "Connecting..."}
                {callError ? ` - ${callError}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={toggleMic} className="rounded-full border border-border bg-panel2 p-2 text-muted hover:text-accent2" title={micEnabled ? "Mute mic" : "Unmute mic"}>
                {micEnabled ? <Mic size={16} /> : <MicOff size={16} />}
              </button>
              <button onClick={toggleCamera} className="rounded-full border border-border bg-panel2 p-2 text-muted hover:text-accent2" title={cameraEnabled ? "Turn camera off" : "Turn camera on"}>
                {cameraEnabled ? <Video size={16} /> : <VideoOff size={16} />}
              </button>
              <button onClick={endCall} className="rounded-full bg-red-500 p-2 text-white hover:bg-red-500/90" title="End call">
                <PhoneOff size={16} />
              </button>
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[180px_1fr]">
            <div ref={localVideoRef} className="flex h-32 items-center justify-center rounded-xl border border-border bg-panel2 text-xs text-muted">
              {cameraEnabled ? null : "Camera off"}
            </div>
            <div ref={remoteMediaRef} className="grid max-h-52 grid-cols-1 gap-2 overflow-y-auto md:grid-cols-2">
              {remoteParticipants.length === 0 && (
                <div className="flex h-32 items-center justify-center rounded-xl border border-border bg-panel2 text-xs text-muted">
                  Waiting for others
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showCreateGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 px-4 py-4">
          <div className="w-full max-w-md rounded-3xl border border-border bg-panel p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-lg font-semibold">Create group chat</p>
                <p className="text-sm text-muted">Pick friends to add instantly.</p>
              </div>
              <button onClick={() => setShowCreateGroup(false)} className="rounded-full p-2 text-muted hover:bg-panel2">
                <X size={18} />
              </button>
            </div>

            <label className="block mb-4">
              <span className="mb-1 block text-sm text-muted">Group name</span>
              <input
                value={groupNameInput}
                onChange={(event) => setGroupNameInput(event.target.value)}
                placeholder="Weekend plans"
                className="w-full rounded-xl border border-border bg-panel2 px-3 py-2.5 outline-none focus:border-accent"
              />
            </label>

            <div className="max-h-72 overflow-y-auto rounded-2xl border border-border bg-panel2/70 p-2">
              {friends.length === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-muted">Add friends before making a group.</p>
              ) : (
                friends.map((friend) => {
                  const checked = selectedGroupMembers.has(friend.id);
                  return (
                    <button
                      key={friend.id}
                      type="button"
                      onClick={() => {
                        setSelectedGroupMembers((prev) => {
                          const next = new Set(prev);
                          if (next.has(friend.id)) {
                            next.delete(friend.id);
                          } else {
                            next.add(friend.id);
                          }
                          return next;
                        });
                      }}
                      className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                        checked ? "bg-accent/15 text-accent" : "hover:bg-bg/60"
                      }`}
                    >
                      <AvatarBadge
                        src={friend.avatar_url}
                        name={friend.username}
                        className="h-9 w-9 rounded-full bg-gradient-to-br from-accent to-accent2 shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{friend.username}</span>
                      <span className={`h-5 w-5 rounded-md border flex items-center justify-center ${checked ? "border-accent bg-accent text-bg" : "border-border"}`}>
                        {checked ? <Check size={13} /> : null}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <button
              type="button"
              onClick={createGroupChat}
              disabled={selectedGroupMembers.size === 0}
              className="mt-4 w-full rounded-2xl bg-gradient-to-br from-accent to-accent2 px-3 py-2.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Create group chat
            </button>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 px-4 py-4">
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl border border-border bg-panel p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-lg font-semibold">Settings</p>
                <p className="text-sm text-muted">Customize your profile and experience.</p>
              </div>
              <button onClick={() => setSettingsOpen(false)} className="rounded-full p-2 text-muted hover:bg-panel2">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-full overflow-hidden bg-gradient-to-br from-accent to-accent2 flex items-center justify-center text-lg font-bold">
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt="Avatar" className="h-full w-full object-cover" />
                  ) : (
                    initials(profile?.username ?? currentUser.email)
                  )}
                </div>
                <div>
                  <button type="button" onClick={() => avatarInputRef.current?.click()} className="rounded-full border border-border bg-panel2 px-3 py-1.5 text-sm hover:border-accent">
                    Change avatar
                  </button>
                  <input ref={avatarInputRef} type="file" className="hidden" accept="image/*" onChange={handleAvatarUpload} />
                </div>
              </div>

              <label className="block">
                <span className="mb-1 block text-sm text-muted">Username</span>
                <input value={usernameInput} onChange={(e) => setUsernameInput(e.target.value)} className="w-full rounded-xl border border-border bg-panel2 px-3 py-2.5 outline-none focus:border-accent" />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm text-muted">Pronouns</span>
                <input value={pronounsInput} onChange={(e) => setPronounsInput(e.target.value)} placeholder="she/her" className="w-full rounded-xl border border-border bg-panel2 px-3 py-2.5 outline-none focus:border-accent" />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm text-muted">Bio</span>
                <textarea value={bioInput} onChange={(e) => setBioInput(e.target.value)} rows={3} placeholder="Tell people a bit about yourself" className="w-full rounded-xl border border-border bg-panel2 px-3 py-2.5 outline-none focus:border-accent" />
              </label>

              <div className="rounded-2xl border border-border bg-panel2 p-3 space-y-3">
                <div>
                  <p className="font-medium">Status</p>
                  <p className="text-sm text-muted">Let friends know what you’re up to.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["online", "idle", "dnd", "offline"] as const).map((value) => (
                    <button key={value} type="button" onClick={() => setStatusInput(value)} className={`rounded-full border px-2.5 py-1.5 text-sm ${statusInput === value ? "border-accent bg-accent/15 text-accent" : "border-border bg-bg/60"}`}>
                      {formatPresenceLabel(value)}
                    </button>
                  ))}
                </div>
                <input value={statusMessageInput} onChange={(e) => setStatusMessageInput(e.target.value)} placeholder="Working on something cool" className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 outline-none focus:border-accent" />
              </div>

              <div className="rounded-2xl border border-border bg-panel2 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Theme</p>
                    <p className="text-sm text-muted">Switch between dark and light mode.</p>
                  </div>
                  <button onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))} className="rounded-full border border-border bg-bg px-3 py-1.5 text-sm">
                    {theme === "dark" ? "Dark" : "Light"}
                  </button>
                </div>
              </div>

              <button onClick={saveProfileSettings} className="w-full rounded-2xl bg-gradient-to-br from-accent to-accent2 px-3 py-2.5 font-semibold text-white">
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div className="fixed z-50 rounded-2xl border border-border bg-panel2 p-2 shadow-xl" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button
            onClick={() => {
              const msg = messages.find((item) => item.id === contextMenu.id);
              if (msg) {
                setReplyTarget({ id: msg.id, senderName: msg.sender_id === currentUser.id ? "you" : selectedTitle || "them", text: parseMessageContent(msg.content).text, fileName: msg.file_name });
              }
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-panel"
          >
            Reply
          </button>
          <button
            onClick={() => {
              const emojis = ["👍", "❤️", "😂", "🔥", "🎉"];
              const emoji = emojis[Math.floor(Math.random() * emojis.length)];
              handleReaction(contextMenu.id, emoji);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-panel"
          >
            Add reaction
          </button>
          {messages.find((item) => item.id === contextMenu.id)?.sender_id === currentUser.id && (
            <button
              onClick={() => {
                handleDeleteMessage(contextMenu.id);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-400 hover:bg-panel"
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AvatarBadge({
  src,
  name,
  className,
}: {
  src: string | null | undefined;
  name: string;
  className?: string;
}) {
  return (
    <div className={`overflow-hidden ${className ?? ""}`}>
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[11px] font-bold text-white">
          {name.slice(0, 2).toUpperCase()}
        </div>
      )}
    </div>
  );
}

function formatPresenceLabel(status: Profile["status"] | undefined) {
  switch (status) {
    case "idle":
      return "Idle";
    case "dnd":
      return "Do Not Disturb";
    case "offline":
      return "Offline";
    default:
      return "Online";
  }
}

function statusBadgeClass(status: Profile["status"] | undefined) {
  switch (status) {
    case "idle":
      return "bg-amber-400";
    case "dnd":
      return "bg-rose-500";
    case "offline":
      return "bg-slate-500";
    default:
      return "bg-emerald-400";
  }
}

function statusPillClass(status: Profile["status"] | undefined) {
  switch (status) {
    case "idle":
      return "border-amber-400/40 bg-amber-400/10 text-amber-300";
    case "dnd":
      return "border-rose-500/40 bg-rose-500/10 text-rose-300";
    case "offline":
      return "border-slate-500/40 bg-slate-500/10 text-slate-300";
    default:
      return "border-emerald-400/40 bg-emerald-400/10 text-emerald-300";
  }
}

function presenceSubtitle(profile: Profile | null | undefined) {
  if (!profile) return "Offline";
  if (profile.status_message) return profile.status_message;
  return formatPresenceLabel(profile.status ?? "offline");
}

function conversationTitle(conversation: Conversation) {
  return conversation.type === "dm" ? conversation.profile.username : conversation.group.name;
}

function conversationSubtitle(conversation: Conversation) {
  if (conversation.type === "dm") {
    return presenceSubtitle(conversation.profile);
  }

  const names = conversation.members.map((member) => member.username);
  if (names.length === 0) return "Group chat";
  return `${names.length} members: ${names.slice(0, 4).join(", ")}${names.length > 4 ? "..." : ""}`;
}

function messageSenderName(message: Message, conversation: Conversation, currentUserId: string) {
  if (message.sender_id === currentUserId) return "You";
  if (message.sender_name) return message.sender_name;
  if (conversation.type === "group") {
    return conversation.members.find((member) => member.id === message.sender_id)?.username ?? "Someone";
  }
  return conversation.profile.username;
}

function callTitle(call: CallRow, groups: GroupChat[], selected: Conversation | null) {
  if (call.group_id) {
    return groups.find((group) => group.id === call.group_id)?.name ?? (selected?.type === "group" ? selected.group.name : "Group call");
  }
  if (selected?.type === "dm" && (selected.profile.id === call.receiver_id || selected.profile.id === call.caller_id)) {
    return `Call with ${selected.profile.username}`;
  }
  return `Call with ${call.caller_name}`;
}

function extractUrl(text: string | null | undefined) {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s]+/);
  if (!match) return null;
  try {
    new URL(match[0]);
    return match[0];
  } catch {
    return null;
  }
}

function parseMessageContent(content: string | null): MessagePayload {
  if (!content) {
    return { text: "", reply: null, reactions: {}, deleted: false, embedUrl: null };
  }

  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object" && "text" in parsed) {
      return {
        text: typeof parsed.text === "string" ? parsed.text : "",
        reply: parsed.reply ?? null,
        reactions: parsed.reactions ?? {},
        deleted: Boolean(parsed.deleted),
        embedUrl: parsed.embedUrl ?? null,
      };
    }
  } catch {
    // fall back to plain text
  }

  return { text: content, reply: null, reactions: {}, deleted: false, embedUrl: extractUrl(content) };
}

function serializeMessagePayload(payload: MessagePayload) {
  return JSON.stringify(payload);
}
