"use client";

import type { Profile } from "@/lib/types";
import { profileFill, profileInitial, profileSoftFill } from "@/lib/profile-ui";

export function ProfileBadge({
  profile,
  size = 18,
  title,
}: {
  profile: Profile;
  size?: number;
  title?: string;
}) {
  const initial = profileInitial(profile);
  return (
    <span
      title={title ?? profile.name}
      aria-label={title ?? profile.name}
      className="inline-grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background: profileSoftFill(profile.color),
        color: profileFill(profile.color),
        fontSize: Math.round(size * 0.55),
        fontWeight: 600,
        lineHeight: 1,
      }}
    >
      {initial}
    </span>
  );
}
