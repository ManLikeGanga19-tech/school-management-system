"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Cookie, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";

const CONSENT_KEY = "shulehq_cookie_consent";

type ConsentChoice = "accepted" | "rejected";

export function CookieConsentBanner() {
  const [choice, setChoice] = useState<ConsentChoice | null | undefined>(undefined);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(CONSENT_KEY);
    if (stored === "accepted" || stored === "rejected") {
      setChoice(stored);
      return;
    }
    setChoice(null);
  }, []);

  const setConsent = (nextChoice: ConsentChoice) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CONSENT_KEY, nextChoice);
    }
    setChoice(nextChoice);
  };

  return (
    <AnimatePresence>
      {choice === null ? (
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-x-4 bottom-4 z-50 sm:inset-x-auto sm:left-4 sm:max-w-md"
        >
          <div className="rounded-[1.75rem] border border-slate-200 bg-white/96 p-4 shadow-[0_20px_60px_rgba(15,23,42,0.18)] backdrop-blur">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
                <Cookie className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                  This website uses cookies
                  <ShieldCheck className="size-4 text-[#b9512d]" />
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  We use essential cookies to keep sign-in state, onboarding steps, and secure navigation working correctly across the public site.
                </p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    className="rounded-full bg-slate-950 text-white hover:bg-slate-800"
                    onClick={() => setConsent("accepted")}
                  >
                    Accept cookies
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => setConsent("rejected")}
                  >
                    Reject cookies
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
