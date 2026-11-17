import { Newsreader } from "next/font/google";
import "./dashboard.css";

// The dashboard's serif, for board names and headings. Loaded here rather than
// in the root layout so the canvas and sign-in pages do not pay for a font they
// never use. The UI sans is Geist, already loaded globally by the root layout.
const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  style: ["normal", "italic"],
  display: "swap",
});

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <div className={newsreader.variable}>{children}</div>;
}
