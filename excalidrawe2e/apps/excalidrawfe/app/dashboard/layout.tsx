import { Space_Grotesk } from "next/font/google";
import "./dashboard.css";

// The dashboard's one typeface, used for everything. Loaded here rather than in
// the root layout so the canvas and sign-in pages do not pay for a font they
// never use.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <div className={spaceGrotesk.variable}>{children}</div>;
}
