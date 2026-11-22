import type { Metadata } from "next";
import { Landing } from "@/component/Landing";

export const metadata: Metadata = {
  title: "ChalkLine · a shared whiteboard",
  description: "Sketch flows, map ideas and draw with your team on one live board. Share it with a link.",
};

export default function Home() {
  return <Landing />;
}
