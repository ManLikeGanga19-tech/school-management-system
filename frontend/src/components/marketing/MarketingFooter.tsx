import Link from "next/link";
import { ShieldCheck, Mail, MapPin, Phone } from "lucide-react";

export function MarketingFooter() {
  return (
    <footer className="bg-dark-navy text-warm-cream pt-20 pb-12 border-t border-white/10 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-16 mb-20">
          <div className="col-span-1 md:col-span-2 lg:col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-8 group">
              <div className="w-10 h-10 bg-brand-primary rounded-xl flex items-center justify-center text-white shadow-lg shadow-brand-primary/20">
                <ShieldCheck size={24} />
              </div>
              <span className="text-2xl font-bold tracking-tight text-white italic font-display">
                Shule<span className="text-brand-primary font-black">HQ</span>
              </span>
            </Link>
            <p className="text-warm-cream/60 text-base max-w-sm leading-relaxed mb-8 font-medium">
              Kenya's modern SaaS for private schools. Specialized in CBC curriculum automation and seamless M-Pesa fee reconciliation.
            </p>
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-warm-cream/50 text-sm font-medium">
                <Mail className="w-4 h-4 text-brand-primary" />
                <span>support@shulehq.co.ke</span>
              </div>
              <div className="flex items-center gap-3 text-warm-cream/50 text-sm font-medium">
                <Phone className="w-4 h-4 text-brand-primary" />
                <span>+254 712 345 678</span>
              </div>
              <div className="flex items-center gap-3 text-warm-cream/50 text-sm font-medium">
                <MapPin className="w-4 h-4 text-brand-primary" />
                <span>Nairobi, Kenya</span>
              </div>
            </div>
          </div>

          <div>
            <h5 className="label-caps text-white mb-8">Product</h5>
            <ul className="space-y-4 text-[15px] text-warm-cream/60 font-medium">
              <li><Link href="/features" className="hover:text-brand-primary transition-colors">Features</Link></li>
              <li><Link href="/pricing" className="hover:text-brand-primary transition-colors">Pricing</Link></li>
              <li><Link href="/demo" className="hover:text-brand-primary transition-colors">Request Demo</Link></li>
              <li><Link href="/changelog" className="hover:text-brand-primary transition-colors">Changelog</Link></li>
            </ul>
          </div>

          <div>
            <h5 className="label-caps text-white mb-8">Company</h5>
            <ul className="space-y-4 text-[15px] text-warm-cream/60 font-medium">
              <li><Link href="/about" className="hover:text-brand-primary transition-colors">About Us</Link></li>
              <li><Link href="/blog" className="hover:text-brand-primary transition-colors">Journal</Link></li>
              <li><Link href="/careers" className="hover:text-brand-primary transition-colors">Careers</Link></li>
              <li><Link href="/demo" className="hover:text-brand-primary transition-colors">Contact</Link></li>
            </ul>
          </div>

          <div>
            <h5 className="label-caps text-white mb-8">Resources</h5>
            <ul className="space-y-4 text-[15px] text-warm-cream/60 font-medium">
              <li><Link href="/cbc-guide" className="hover:text-brand-primary transition-colors">CBC Guide</Link></li>
              <li><Link href="/mpesa-setup" className="hover:text-brand-primary transition-colors">M-Pesa Setup</Link></li>
              <li><Link href="/help" className="hover:text-brand-primary transition-colors">Help Center</Link></li>
              <li><Link href="/privacy" className="hover:text-brand-primary transition-colors">Privacy</Link></li>
            </ul>
          </div>
        </div>

        <div className="flex flex-col md:flex-row justify-between items-center pt-12 border-t border-white/5 gap-8">
          <p className="text-warm-cream/30 text-[11px] font-semibold uppercase tracking-[0.2em]">
            © 2026 ShuleHQ Technology Ltd. Made in Kenya 🇰🇪
          </p>
          <div className="flex space-x-8 text-[11px] font-semibold uppercase tracking-[0.2em] text-warm-cream/30">
            <Link href="/privacy" className="hover:text-brand-primary transition-colors">Privacy Policy</Link>
            <a href="#" className="hover:text-brand-primary transition-colors">Terms of Service</a>
            <a href="#" className="hover:text-brand-primary transition-colors">Data Processing</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
