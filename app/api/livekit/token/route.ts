import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { createClient } from "@/utils/supabase/server";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const REFRESH_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  console.log("LIVEKIT TOKEN ROUTE HIT");

  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    console.log("User:", user);
    console.log("User error:", userError);

    if (userError || !user) {
      return NextResponse.json(
        {
          error: "Not authenticated",
          userError,
        },
        { status: 401 }
      );
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    console.log("Profile:", profile);
    console.log("Profile error:", profileError);

console.log("Authenticated user ID:", user.id);

const { data: allProfiles } = await supabase
  .from("profiles")
  .select("id, username");

console.log("Profiles table:", allProfiles);

if (profileError || !profile) {
  return NextResponse.json(
    {
      error: "Profile not found",
      authUserId: user.id,
      profileError,
      profiles: allProfiles,
    },
    { status: 404 }
  );
}

    const body = await request.json().catch(() => ({}));
    const roomName = body.roomName?.trim();

    const expiresAt = profile.livekit_token_expires_at
      ? new Date(profile.livekit_token_expires_at).getTime()
      : 0;

    if (
      !roomName &&
      profile.livekit_token &&
      expiresAt - Date.now() > REFRESH_WINDOW_MS
    ) {
      return NextResponse.json({
        token: profile.livekit_token,
        expiresAt: profile.livekit_token_expires_at,
        identity: profile.username,
      });
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        { error: "Missing LIVEKIT_API_KEY or LIVEKIT_API_SECRET" },
        { status: 500 }
      );
    }

    const token = new AccessToken(apiKey, apiSecret, {
      identity: profile.username,
      name: profile.username,
      ttl: ONE_YEAR_SECONDS,
    });

    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const jwt = await token.toJwt();

    const nextExpiresAt = new Date(
      Date.now() + ONE_YEAR_SECONDS * 1000
    ).toISOString();

    if (!roomName) {
      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          livekit_token: jwt,
          livekit_token_expires_at: nextExpiresAt,
          livekit_identity: profile.username,
        })
        .eq("id", user.id);

      if (updateError) {
        console.error(updateError);
      }
    }

    return NextResponse.json({
      token: jwt,
      expiresAt: nextExpiresAt,
      identity: profile.username,
    });
  } catch (err) {
    console.error(err);

    return NextResponse.json(
      {
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}