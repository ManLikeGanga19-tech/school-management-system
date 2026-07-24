/**
 * Blog content — real use cases grounded in what ShuleHQ actually does.
 * No invented statistics and no quotes attributed to real people. Every claim
 * here maps to a shipped capability (KEMIS/ULI records, instant SMS receipts
 * on recorded payments, CBC rubric-to-report-card).
 */

export type ContentBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "blockquote"; text: string }
  | { type: "ul"; items: string[] };

export type BlogPost = {
  id: string;
  title: string;
  excerpt: string;
  category: string;
  author: string;
  authorTitle: string;
  date: string;
  readTime: string;
  imageCaption: string;
  content: ContentBlock[];
};

export const BLOG_POSTS: BlogPost[] = [
  {
    id: "kemis-uli-records",
    title: "Capture Student Data Once: KEMIS-Ready Records Without the Re-keying",
    excerpt:
      "Kenyan schools re-type the same learner details into NEMIS/KEMIS, exam bodies and their own files. ShuleHQ captures it once — ULI and all — and keeps it consistent.",
    category: "Compliance",
    author: "Daniel Oganga",
    authorTitle: "Founder, ShuleHQ",
    date: "24 Jul 2026",
    readTime: "6 min read",
    imageCaption: "A single, KEMIS-aligned learner record",
    content: [
      { type: "p", text: "Ask any school secretary where their time goes and 'entering the same student details in three places' will be near the top. The learner's name, birth certificate number, and unique identifier get typed into the government system, again into exam registrations, and again into the school's own registers and report cards. Every re-keying is a chance to introduce a mismatch — and a mismatch on a national record is a slow, painful thing to fix." },
      { type: "h2", text: "One record, aligned to the national standard" },
      { type: "p", text: "ShuleHQ was built around the way Kenyan schools are actually regulated. A learner is captured once, with the fields the national system expects — including the Unique Learner Identifier (ULI) that replaced the older NEMIS UPI — alongside the biodata, guardian and previous-school details a school needs day to day." },
      { type: "ul", items: [
        "ULI and core biodata captured once, on one screen",
        "Guardian and emergency-contact details attached to the learner, not scattered across files",
        "Previous school and admission history kept with the record for transfers",
        "The same record drives class registers, report cards and statements — no re-typing",
      ] },
      { type: "h2", text: "Why it matters at term start" },
      { type: "p", text: "Enrolment season is when re-keying hurts most. With one clean record per learner, a new admission flows straight into the class register, the fee structure, and — when the time comes — the report card, without anyone copying it forward by hand." },
      { type: "blockquote", text: "The goal is simple: type it right once, and never type it again." },
      { type: "p", text: "That is the quiet difference a KEMIS-aligned record makes. Not a flashy feature — just hours of a secretary's week handed back, and a record you can trust when the national system asks for it." },
    ],
  },
  {
    id: "instant-sms-receipts",
    title: "Every Payment, an Instant SMS Receipt: How Schools End Fee Disputes",
    excerpt:
      "You keep collecting fees however you do — cash, M-Pesa, bank or cheque. ShuleHQ turns each recorded payment into an instant SMS receipt the parent can verify, so 'I already paid' arguments disappear.",
    category: "School Finance",
    author: "Daniel Oganga",
    authorTitle: "Founder, ShuleHQ",
    date: "24 Jul 2026",
    readTime: "5 min read",
    imageCaption: "A recorded payment becomes an instant parent receipt",
    content: [
      { type: "p", text: "Fee disputes rarely start with dishonesty. They start with a gap: a parent pays, the receipt book is somewhere else, the ledger gets updated on Friday, and two weeks later nobody can agree on what was paid. The money is fine — the record isn't." },
      { type: "h2", text: "Keep collecting the way you already do" },
      { type: "p", text: "ShuleHQ does not change how your school takes money. Cash, M-Pesa, bank transfer, cheque — the secretary records the payment (or scans the physical receipt with any phone), and the reference is captured against the right learner." },
      { type: "h2", text: "The moment it's recorded, three things happen" },
      { type: "ul", items: [
        "The learner's invoice and balance update immediately — no Friday reconciliation",
        "The parent gets an SMS receipt on the spot",
        "That receipt is verifiable on a secure portal, so a parent can always prove what they paid",
      ] },
      { type: "p", text: "None of this requires an M-Pesa integration or any change to your bank accounts. Your school keeps full control of the actual money; ShuleHQ keeps an honest, shared record of the flow." },
      { type: "blockquote", text: "When both sides can see the same receipt, the argument is already over." },
      { type: "p", text: "The result is boring in the best way: balances everyone agrees on, and a term-end that isn't spent chasing paper." },
    ],
  },
  {
    id: "cbc-report-cards-daily",
    title: "CBC Report Cards Without the Term-End All-Nighter",
    excerpt:
      "CBC means continuous assessment — thousands of small observations a term. Enter them digitally as you go and the KICD-standard report card assembles itself, instead of eating a teacher's weekend.",
    category: "CBC Excellence",
    author: "Daniel Oganga",
    authorTitle: "Founder, ShuleHQ",
    date: "24 Jul 2026",
    readTime: "7 min read",
    imageCaption: "From daily rubric entries to a finished report card",
    content: [
      { type: "p", text: "The Competency-Based Curriculum changed what assessment means. Under 8-4-4, the big moments were exams. Under CBC, learning is judged continuously — strand by strand, sub-strand by sub-strand — which is better for children and much heavier on record-keeping. For a school with hundreds of learners, that is thousands of data points every term." },
      { type: "h2", text: "Enter it as it happens, not at the end" },
      { type: "p", text: "ShuleHQ lets teachers record formative assessment on any device, using the KICD performance levels — Exceeding, Meeting, Approaching and Below Expectation — against the actual strands and sub-strands. Each entry is small; done as you teach, it never piles up." },
      { type: "h2", text: "The report card assembles itself" },
      { type: "ul", items: [
        "Summative results aggregate per learning area automatically",
        "KICD-standard report cards generate per learner, per term",
        "Stream distribution and term-over-term views show how a class is tracking",
        "No Sunday spent calculating totals by hand",
      ] },
      { type: "blockquote", text: "CBC is about seeing each child's competencies clearly. Teachers can't do that while drowning in assessment sheets." },
      { type: "p", text: "Done this way, the report card stops being a deadline and becomes a by-product of teaching that was already recorded. The teacher's weekend stays theirs." },
    ],
  },
];

export function getPostById(id: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.id === id);
}
