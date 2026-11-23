"use client";
import React from "react";
import { avatarUrl } from "@/lib/avatars";

/**
 *
 * The circle and its background live here rather than in the SVG files. The
 * generated avatars are transparent on purpose: one copy of each face then
 * works on this light dashboard and on a dark canvas, and a colour decision
 * is not frozen into a file that is meant to be immutable and cached forever.
 *
 * `<img src>` rather than inlining the SVG. An SVG in an img tag is a picture
 * - scripts in it do not run, external references are not fetched - which is
 * the same distinction `ALLOWED_IMAGE_TYPES` makes when it refuses uploaded
 * SVGs. These are first-party generated files, but there is no reason to give
 * them more privilege than they need, and an img also gets the browser cache
 * and a lazily-loaded grid for free.
 */
export function Avatar({
  id,
  username,
  size = 40,
  className = "",
  lazy = false,
}: {
  id: string | null | undefined;
  /** shown as an initial while there is nothing to draw */
  username?: string;
  size?: number;
  className?: string;
  lazy?: boolean;
}) {
  const url = avatarUrl(id);

  return (
    // shape in globals.css (.pu-avatar); colours from the page showing it
    <span
      className={`pu-avatar ${className}`}
      style={{ width: size, height: size }}
    >
      {url ? (
        <img
          src={url}
          // the face is decoration next to a name that is already on screen,
          // so an empty alt keeps a screen reader from reading it twice
          alt=""
          width={size}
          height={size}
          loading={lazy ? "lazy" : "eager"}
        />
      ) : (
        <span
          className="pu-avatar-initial"
          style={{ fontSize: size * 0.4 }}
        >
          {(username ?? "?").charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}
