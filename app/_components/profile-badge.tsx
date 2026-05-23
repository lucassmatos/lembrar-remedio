"use client";

import type { Profile } from "@/lib/types";
import { profileFill, profileInitial, profileSoftFill } from "@/lib/profile-ui";

export function ProfileBadge({
  profile,
  size = 20,
  title,
}: {
  profile: Profile;
  size?: number;
  title?: string;
}) {
  const showInitial = size >= 18;
  const initial = profileInitial(profile);
  return (
    <span
      title={title ?? profile.name}
      aria-label={title ?? profile.name}
      className="inline-grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background: showInitial ? profileSoftFill(profile.color) : profileFill(profile.color),
        color: profileFill(profile.color),
        fontSize: Math.max(10, Math.round(size * 0.58)),
        fontWeight: 600,
        lineHeight: 1,
        letterSpacing: "-0.01em",
      }}
    >
      {showInitial ? initial : null}
    </span>
  );
}
