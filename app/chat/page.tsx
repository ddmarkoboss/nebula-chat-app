import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import ChatClient from "./ChatClient";

export default async function ChatPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    const fallbackUsername =
      (user.user_metadata?.username as string | undefined) ??
      user.email?.split("@")[0] ??
      "user";

    const { data: createdProfile } = await supabase
      .from("profiles")
      .upsert({
        id: user.id,
        username: fallbackUsername,
        status: "online",
        last_seen: new Date().toISOString(),
      })
      .select()
      .single();

    profile = createdProfile;
  }

  const { data: friendRows } = await supabase
    .from("friends")
    .select("*")
    .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`);

  const friendIds = new Set<string>();
  (friendRows ?? []).forEach((row) => {
    if (row.status === "accepted") {
      friendIds.add(row.user_id === user.id ? row.friend_id : row.user_id);
    }
  });

  const { data: friendProfiles } =
    friendIds.size > 0
      ? await supabase.from("profiles").select("*").in("id", Array.from(friendIds))
      : { data: [] };

  const incomingRequests = (friendRows ?? []).filter(
    (row) => row.status === "pending" && row.friend_id === user.id
  );
  const requesterIds = incomingRequests.map((r) => r.user_id);
  const { data: requesterProfiles } =
    requesterIds.length > 0
      ? await supabase.from("profiles").select("*").in("id", requesterIds)
      : { data: [] };

  const outgoingRequests = (friendRows ?? []).filter(
    (row) => row.status === "pending" && row.user_id === user.id
  );
  const addresseeIds = outgoingRequests.map((r) => r.friend_id);
  const { data: addresseeProfiles } =
    addresseeIds.length > 0
      ? await supabase.from("profiles").select("*").in("id", addresseeIds)
      : { data: [] };

  return (
    <ChatClient
      currentUser={{ id: user.id, email: user.email ?? "" }}
      currentProfile={profile}
      friends={friendProfiles ?? []}
      incomingRequests={(requesterProfiles ?? []).map((p) => ({
        requestRowId:
          incomingRequests.find((r) => r.user_id === p.id)?.id ?? "",
        profile: p,
      }))}
      outgoingRequests={(addresseeProfiles ?? []).map((p) => ({
        requestRowId:
          outgoingRequests.find((r) => r.friend_id === p.id)?.id ?? "",
        profile: p,
      }))}
    />
  );
}
