"use client";

import Link from "next/link";
import { Calendar, ArrowLeft, ArrowRight, Share2, Bookmark, BookOpen, Facebook, Twitter, Linkedin, MessageSquare } from "lucide-react";

const post = {
  title: "How to Transition Your Private School to CBC Without the Paperwork Headache",
  category: "CBC Excellence",
  author: "Faith Wambui",
  authorTitle: "CEO, Former School Director",
  date: "May 10, 2024",
  readTime: "8 min read",
  content: [
    { type: "p", text: "The shift from 8-4-4 to the Competency-Based Curriculum (CBC) has been one of the most significant changes in the history of Kenyan education. For private school directors, it's not just a change in syllabus; it's a complete shift in administrative requirements." },
    { type: "h2", text: "The Challenge of Continuous Assessment" },
    { type: "p", text: "Under the old system, exams were the primary metric. You had mid-terms and end-of-terms. Now, formative assessment means teachers must record observations almost daily. For a school with 300 students, that's thousands of data points every week." },
    { type: "blockquote", text: "CBC is about identifying the unique competency of every child. You can't do that if your teachers are drowning in assessment sheets." },
    { type: "h2", text: "3 Steps to Digital Transition" },
    { type: "p", text: "1. Standardize your grading language: Ensure all teachers understand the difference between 'Exceeding Expectation' (EE) and 'Meeting Expectation' (ME) in the context of specific learning areas." },
    { type: "p", text: "2. Automate the aggregation: Don't let teachers spend Sundays calculating final scores. A system like ShuleHQ does this instantly as rubric scores are entered." },
    { type: "p", text: "3. Share with parents early: Don't wait for the report card. Use the parent portal to share small wins and support needs as they happen." },
  ],
};

export default function BlogPostPage() {
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
              <p className="text-sm">Digital assessment in action — visualization</p>
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

      <section className="py-24 px-4 bg-warm-cream border-t border-brand-border">
        <div className="max-w-7xl mx-auto">
          <h3 className="text-2xl font-bold text-dark-navy mb-12 tracking-tight">Keep Reading</h3>
          <div className="grid md:grid-cols-2 gap-8">
            {[
              { tag: "Up Next", title: "Digital Fee Collection: 5 Common Myths Debunked", desc: "Learn why parents actually prefer digital invoices over paper slips, and how to make the move safely." },
              { tag: "Previous", title: "Preparing for the August Teacher's Conference", desc: "A checklist of what to prepare for your staff before the mid-year pedagogical review." },
            ].map((related, i) => (
              <Link key={i} href="/blog" className="ds-card p-8 bg-white border-brand-border hover:border-brand-primary/30 hover:shadow-xl transition-all group shadow-sm">
                <p className="label-caps text-brand-primary mb-4">{related.tag}</p>
                <h4 className="text-xl font-bold text-dark-navy mb-4 group-hover:text-brand-primary transition-colors tracking-tight">{related.title}</h4>
                <p className="text-muted-text text-sm font-normal mb-8 leading-relaxed">{related.desc}</p>
                <span className="flex items-center gap-2 text-brand-primary font-bold label-caps">
                  Read Article <ArrowRight size={14} />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

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
