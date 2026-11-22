"use client"
import React, { useState } from 'react';
import { Space_Grotesk, Caveat } from "next/font/google";
import { ArrowRight, AtSign, CircleAlert, CircleCheck, Eye, EyeOff, LoaderCircle, Lock, Mail, PenLine, UserRound } from 'lucide-react';
import axios from 'axios'
import {useRouter} from "next/navigation"
import { setToken } from "@/lib/session"
import { API_URL } from "@/lib/config"
import { errorMessage } from "@/lib/errors"
import { AuthHero } from "./AuthHero"
import "./AuthPage.css"

// Same face as the dashboard; Caveat only draws the labels inside the hero sketch.
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", display: "swap" });
const caveat = Caveat({ subsets: ["latin"], weight: "600", variable: "--font-caveat", display: "swap" });

type Mode = "signin" | "signup";

/** Label + icon + input, in the one shape every field on this page shares. */
function Field({ id, label, icon, trailing, ...input }: {
    id: string;
    label: string;
    icon: React.ReactNode;
    trailing?: React.ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>) {
    return (
        <div className="au-field">
            <label htmlFor={id} className="au-label">{label}</label>
            <div className="au-control">
                {icon}
                <input id={id} className="au-input" required {...input} />
                {trailing}
            </div>
        </div>
    );
}

function EyeToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
    return (
        <button type="button" className="au-eye" onClick={onToggle} aria-label={shown ? "Hide password" : "Show password"}>
            {shown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        </button>
    );
}

/**
 * Sign in and create account, both always mounted.
 *
 * Each form owns one half of the frame and the hero card covers the other, so
 * switching modes is just the card sliding across. That only works if switching
 * does not navigate, so the URL is swapped in place instead (/signin and
 * /signup still each land on their own mode).
 */
export function AuthPage({ isSignin }: { isSignin: boolean }) {
    const [mode, setMode] = useState<Mode>(isSignin ? "signin" : "signup");
    // set on the first switch, so the card does not animate in on page load
    const [anim, setAnim] = useState<"to-left" | "to-right" | undefined>();

    // one field on sign-in: a username or an email, because guests only ever
    // have the first and everyone who signed up before only had the second
    const [identifier, setIdentifier] = useState("");
    const [signinPassword, setSigninPassword] = useState("");
    const [email, setEmail] = useState("");
    const [username, setUsername] = useState("");
    const [signupPassword, setSignupPassword] = useState("");
    const [showSigninPassword, setShowSigninPassword] = useState(false);
    const [showSignupPassword, setShowSignupPassword] = useState(false);

    const [isLoading, setIsLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const router = useRouter()

    function switchTo(next: Mode) {
        if (next === mode) return;
        setMode(next);
        setAnim(next === "signup" ? "to-left" : "to-right");
        setErrorMsg(null);
        setSuccessMsg(null);
        // replace, not push: Back should leave the page, not flip the card
        window.history.replaceState(null, "", next === "signin" ? "/signin" : "/signup");
    }

    async function signIn() {
        const res = await axios.post(`${API_URL}/signin`,{
            identifier, password: signinPassword
        })
        setToken(res.data.token);
        router.push("/dashboard")
    }

    async function signUp() {
        await axios.post(`${API_URL}/signup`,{
            email, username, password: signupPassword
        })
        // straight into sign-in with the name filled in, rather than a reload of /signin
        switchTo("signin");
        setIdentifier(username);
        setSuccessMsg("Account created. Sign in to continue.");
    }

    /**
     * Start a guest session: one request, no form.
     *
     * The server names the account and returns a token; there is nothing to
     * fill in and nothing to remember. The dashboard then offers to turn it
     * into a real account, which is the only way it survives losing this
     * browser.
     */
    async function continueAsGuest() {
        setIsLoading(true);
        setErrorMsg(null);
        try {
            const res = await axios.post(`${API_URL}/guest`);
            setToken(res.data.token);
            router.push("/dashboard");
        } catch (err) {
            setErrorMsg(errorMessage(err, "Could not start a guest session"));
            setIsLoading(false);
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setErrorMsg(null);
        setSuccessMsg(null);
        try {
            if (mode === "signin") {
                await signIn();
                return; // stay busy while the dashboard loads
            }
            await signUp();
        } catch (err) {
            setErrorMsg(errorMessage(err, "Something went wrong - check your connection and try again"));
        }
        setIsLoading(false);
    };

    const messages = (
        <>
            {errorMsg && (
                <p className="au-msg au-msg--error" role="alert"><CircleAlert aria-hidden />{errorMsg}</p>
            )}
            {successMsg && (
                <p className="au-msg au-msg--ok" role="status"><CircleCheck aria-hidden />{successMsg}</p>
            )}
        </>
    );

    return (
        <main className={`au ${spaceGrotesk.variable} ${caveat.variable}`}>
            <div className="au-frame">
                <section className="au-pane au-pane--signin" aria-label="Sign in" inert={mode !== "signin"}>
                    <form className="au-form" onSubmit={handleSubmit}>
                        <p className="au-brand">ChalkLine</p>
                        <div className="au-head">
                            <h1 className="au-title">Welcome back</h1>
                            <p className="au-sub">Sign in to pick up where you left off.</p>
                        </div>
                        <div className="au-fields">
                            <Field
                                id="signin-identifier"
                                label="Username or email"
                                icon={<UserRound aria-hidden />}
                                // not type="email": the browser would reject a
                                // username as malformed before the request is even sent
                                type="text"
                                autoComplete="username"
                                placeholder="you@studio.com or your username"
                                value={identifier}
                                onChange={(e) => setIdentifier(e.target.value)}
                            />
                            <Field
                                id="signin-password"
                                label="Password"
                                icon={<Lock aria-hidden />}
                                type={showSigninPassword ? "text" : "password"}
                                autoComplete="current-password"
                                placeholder="Your password"
                                value={signinPassword}
                                onChange={(e) => setSigninPassword(e.target.value)}
                                trailing={<EyeToggle shown={showSigninPassword} onToggle={() => setShowSigninPassword((v) => !v)} />}
                            />
                        </div>
                        {mode === "signin" && messages}
                        <button type="submit" className="au-btn au-btn--primary" disabled={isLoading} aria-busy={isLoading}>
                            {isLoading
                                ? <><LoaderCircle className="au-spin" aria-hidden />Signing in…</>
                                : <>Sign in<ArrowRight aria-hidden /></>}
                        </button>
                        <p className="au-switch">
                            New to ChalkLine?
                            <button type="button" onClick={() => switchTo("signup")}>Create an account</button>
                        </p>
                    </form>
                </section>

                <section className="au-pane au-pane--signup" aria-label="Create account" inert={mode !== "signup"}>
                    <form className="au-form" onSubmit={handleSubmit}>
                        <p className="au-brand">ChalkLine</p>
                        <div className="au-head">
                            <h1 className="au-title">Create account</h1>
                            <p className="au-sub">Keep your boards and open them on any device.</p>
                        </div>
                        <div className="au-fields">
                            <Field
                                id="signup-email"
                                label="Email"
                                icon={<Mail aria-hidden />}
                                type="email"
                                autoComplete="email"
                                placeholder="you@studio.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />
                            <Field
                                id="signup-username"
                                label="Username"
                                icon={<AtSign aria-hidden />}
                                type="text"
                                autoComplete="username"
                                placeholder="Pick a username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                            />
                            <Field
                                id="signup-password"
                                label="Password"
                                icon={<Lock aria-hidden />}
                                type={showSignupPassword ? "text" : "password"}
                                autoComplete="new-password"
                                placeholder="At least 8 characters"
                                minLength={8}
                                value={signupPassword}
                                onChange={(e) => setSignupPassword(e.target.value)}
                                trailing={<EyeToggle shown={showSignupPassword} onToggle={() => setShowSignupPassword((v) => !v)} />}
                            />
                        </div>
                        {mode === "signup" && messages}
                        <button type="submit" className="au-btn au-btn--primary" disabled={isLoading} aria-busy={isLoading}>
                            {isLoading
                                ? <><LoaderCircle className="au-spin" aria-hidden />Creating account…</>
                                : "Create account"}
                        </button>
                        <div className="au-or">or</div>
                        {/* Guest: the way in for anyone who does not want an account yet. */}
                        <div className="au-guest">
                            <button type="button" className="au-btn au-btn--secondary" onClick={continueAsGuest} disabled={isLoading}>
                                <PenLine aria-hidden />
                                Continue as guest
                            </button>
                            <p className="au-note">Start drawing right away. Claim the account later to keep your boards.</p>
                        </div>
                        <p className="au-switch">
                            Already have an account?
                            <button type="button" onClick={() => switchTo("signin")}>Sign in</button>
                        </p>
                    </form>
                </section>

                <div className="au-card" data-side={mode === "signin" ? "right" : "left"} data-anim={anim}>
                    <AuthHero />
                </div>
            </div>
        </main>
    );
}
