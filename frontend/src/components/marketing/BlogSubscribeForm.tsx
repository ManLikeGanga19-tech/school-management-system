"use client";

import { useState } from "react";

export function BlogSubscribeForm() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    window.open(
      `mailto:support@shulehq.co.ke?subject=Newsletter%20Subscription&body=Please%20subscribe%20me%3A%20${encodeURIComponent(email)}`,
      "_blank"
    );
    setDone(true);
  };

  if (done) {
    return (
      <p className="text-forest-green font-bold text-center py-4">
        ✓ Thanks! Your email client should open with the subscription request.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-4 max-w-md mx-auto">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Your email address"
        className="flex-1 px-6 py-4 rounded-xl border border-brand-border focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 outline-none transition-all placeholder:font-normal font-bold text-dark-navy"
      />
      <button type="submit" className="btn-primary px-8 py-4 label-caps shadow-lg shadow-brand-primary/20">
        Subscribe
      </button>
    </form>
  );
}
