"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Calendar, ArrowLeft, ArrowRight, Share2, Bookmark, BookOpen, Facebook, Twitter, Linkedin, MessageSquare } from "lucide-react";
import { BLOG_POSTS, getPostById } from "@/lib/blog-posts";

export default function BlogPostPage() {
  const params = useParams();
  const id = Array.isArray(params?.id) ? params.id[0] : (params?.id as string | undefined);
  const post = id ? getPostById(id) : undefined;

  if (!post) {
    return (
      <div className="bg-page-bg min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <p className="label-caps text-brand-primary mb-4">Article not found</p>
          <h1 className="text-3xl font-bold text-dark-navy mb-8 tracking-tight">That article doesn&apos;t exist.</h1>
          <Link href="/blog" className="btn-primary px-8 py-4">Back to the Journal</Link>
        </div>
      </div>
    );
  }

  const related = BLOG_POSTS.filter((p) => p.id !== post.id).slice(0, 2);

  return (
    <div className="bg-page-bg min-h-screen">
      <section className="pt-32 pb-20 bg-page-bg border-b border-brand-border">
        <div className="max-w-4xl mx-auto px-4">
          <Link href="/blog" className="inline-flex items-center gap-2 text-brand-primary font-bold label-caps mb-12 hover:-translate-x-1 transition-transform">
            <ArrowLeft size={16} /> Back to Journal
          </Link>
          <div className="flex items-center gap-4 mb-8">
            <span className="ds-badge bg-teal-accent text-deep-teal">{post.category}</span>
            <span className="label-caps text-muted-text">{post.readTime}</span>
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-dark-navy tracking-tight leading-tight mb-12">
            {post.title}
          </h1>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 pt-8 border-t border-brand-border">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-brand-primary/10 rounded-full border-2 border-white shadow-sm flex items-center justify-center font-bold text-brand-primary">
                {post.author.split(" ").map((n) => n[0]).join("")}
              </div>
              <div>
                <p className="font-bold text-dark-navy text-lg tracking-tight">{post.author}</p>
                <p className="label-caps text-brand-primary mt-0.5">{post.authorTitle}</p>
              </div>
            </div>
            <div className="flex items-center gap-6 text-muted-text">
              <div className="flex items-center gap-2 text-sm font-bold tracking-tight">
                <Calendar size={16} /> {post.date}
              </div>
              <div className="flex items-center gap-4 border-l border-brand-border pl-6">
                <button className="hover:text-brand-primary transition-colors"><Share2 size={18} /></button>
                <button className="hover:text-brand-primary transition-colors"><Bookmark size={18} /></button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <main className="py-24 px-4 overflow-hidden bg-white">
        <div className="max-w-3xl mx-auto">
          <div className="ds-card bg-muted-warm aspect-video flex items-center justify-center p-12 italic text-muted-text/40 font-medium border-brand-border mb-20 shadow-inner">
            <div className="text-center">
              <BookOpen size={48} className="mx-auto mb-4 opacity-10" />
              <p className="text-sm">{post.imageCaption}</p>
            </div>
          </div>

          <div className="prose prose-slate prose-lg max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-headings:text-dark-navy prose-p:text-muted-text prose-p:font-normal prose-p:leading-relaxed prose-a:text-brand-primary prose-a:font-bold">
            {post.content.map((block, i) => {
              if (block.type === "p") return <p key={i} className="mb-8 text-muted-text leading-relaxed">{block.text}</p>;
              if (block.type === "h2") return <h2 key={i} className="text-3xl font-bold text-dark-navy mt-16 mb-8 tracking-tight">{block.text}</h2>;
              if (block.type === "blockquote") return (
                <blockquote key={i} className="mb-12 border-l-4 border-brand-primary bg-hero-gradient p-8 rounded-[2rem] font-bold italic text-dark-navy">
                  {block.text}
                </blockquote>
              );
              if (block.type === "ul") return (
                <ul key={i} className="mb-10 space-y-3">
                  {block.items.map((item, j) => (
                    <li key={j} className="flex gap-3 text-muted-text leading-relaxed">
                      <span className="mt-2 w-1.5 h-1.5 rounded-full bg-brand-primary shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              );
              return null;
            })}
          </div>

          <div className="mt-20 pt-16 border-t border-brand-border">
            <div className="flex flex-col md:flex-row items-center justify-between gap-8">
              <p className="font-bold text-dark-navy tracking-tight">Share with your staff:</p>
              <div className="flex gap-4">
                {[
                  { icon: Facebook, color: "hover:bg-[#1877F2]", href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(typeof window !== "undefined" ? window.location.href : "")}` },
                  { icon: Twitter, color: "hover:bg-[#1DA1F2]", href: `https://twitter.com/intent/tweet?url=${encodeURIComponent(typeof window !== "undefined" ? window.location.href : "")}&text=${encodeURIComponent(post.title)}` },
                  { icon: Linkedin, color: "hover:bg-[#0A66C2]", href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(typeof window !== "undefined" ? window.location.href : "")}` },
                  { icon: MessageSquare, color: "hover:bg-[#25D366]", href: `https://wa.me/?text=${encodeURIComponent(post.title + " " + (typeof window !== "undefined" ? window.location.href : ""))}` },
                ].map((social, i) => (
                  <a key={i} href={social.href} target="_blank" rel="noopener noreferrer" className={`w-12 h-12 bg-muted-warm text-muted-text ${social.color} hover:text-white transition-all rounded-xl flex items-center justify-center shadow-sm hover:shadow-lg`}>
                    <social.icon size={20} />
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>

      {related.length > 0 && (
        <section className="py-24 px-4 bg-warm-cream border-t border-brand-border">
          <div className="max-w-7xl mx-auto">
            <h3 className="text-2xl font-bold text-dark-navy mb-12 tracking-tight">Keep Reading</h3>
            <div className="grid md:grid-cols-2 gap-8">
              {related.map((r) => (
                <Link key={r.id} href={`/blog/${r.id}`} className="ds-card p-8 bg-white border-brand-border hover:border-brand-primary/30 hover:shadow-xl transition-all group shadow-sm">
                  <p className="label-caps text-brand-primary mb-4">{r.category}</p>
                  <h4 className="text-xl font-bold text-dark-navy mb-4 group-hover:text-brand-primary transition-colors tracking-tight">{r.title}</h4>
                  <p className="text-muted-text text-sm font-normal mb-8 leading-relaxed line-clamp-2">{r.excerpt}</p>
                  <span className="flex items-center gap-2 text-brand-primary font-bold label-caps">
                    Read Article <ArrowRight size={14} />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="py-24 px-4 bg-white">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl font-bold text-dark-navy mb-8 tracking-tight">Bring ShuleHQ to your school</h2>
          <p className="text-xl text-muted-text mb-12 font-normal leading-relaxed">
            Join Kenyan private schools digitizing their CBC assessments and fee tracking.
          </p>
          <Link href="/demo" className="btn-primary px-12 py-5 text-xl shadow-2xl shadow-brand-primary/20">
            Get Started Now
          </Link>
        </div>
      </section>
    </div>
  );
}
