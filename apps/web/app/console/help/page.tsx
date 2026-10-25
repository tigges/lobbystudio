import Link from "next/link";
import { OUTCOME_STYLE, REASON_STYLE } from "@/lib/format";

export const metadata = { title: "Help" };

const FLOW = [
  { title: "Visitor asks", body: "in the chat on the practice website" },
  { title: "Assistant answers", body: "or takes a booking request" },
  { title: "Handover", body: "pain, clinical questions, complaints, or “talk to the practice”" },
  { title: "You reply", body: "from the Handovers queue, in the same chat" },
  { title: "Release", body: "hand the visitor back to the assistant" },
  { title: "Review (admin)", body: "Insights, labels and the turn ledger" },
];

const STEPS = [
  {
    id: "visitor",
    title: "1. A visitor asks for the team",
    img: "01-visitor-asks-for-team.webp",
    body: [
      "Visitors chat with the assistant on the practice website. It answers from the practice's own pages and shows a source link under each answer.",
      "The conversation comes to you when the visitor presses “Talk to the practice”, mentions pain, swelling, bleeding or an injury, asks for clinical advice, or raises a complaint or a question about their records. The visitor sees a banner saying the team will reply in the chat, and the assistant asks for their name and phone number so you can always get back to them. For pain or an injury it first asks how bad it is and whether there is swelling or bleeding; for a bill it asks what it's about and for the invoice number. Their answer appears under “What they told the assistant”. Once you reply, the assistant stops asking questions and leaves the conversation to you.",
    ],
  },
  {
    id: "queue",
    title: "2. Check the Handovers queue",
    img: "02-handovers-queue.webp",
    body: [
      "Handovers is the console's start page. Chats waiting for you are listed first: “visitor replied” means the visitor has answered you, and “open” means nobody has replied yet. The coloured label is the reason: red means pain or an emergency, so answer those first.",
      "Booking requests sit underneath. Each one is a call-back request, not a confirmed appointment: phone the visitor, agree a time, and book it in your practice system.",
      "For a business that books online, such as the demo salon, the list is called Bookings. “Booked” ones are already in the diary, with the booking system's reference; “Call back” ones are visitors for whom no offered time suited or the booking system couldn't be reached, so phone them as above.",
      "The page refreshes itself every few seconds, so you can leave it open.",
    ],
  },
  {
    id: "reply",
    title: "3. Read the chat and reply",
    img: "03-reply-to-visitor.webp",
    body: [
      "Click a handover to see the whole conversation and the contact details the assistant collected. Type your reply on the right and press Send reply. It appears in the visitor's chat window straight away, under your name.",
      "The Contact card shows the name and phone number the visitor gave. If they only typed them in the chat, it says “not yet confirmed”: use Confirm contact to save them, or Edit contact to correct them after a phone call.",
      "Leave “Save as the correct answer” ticked when your reply would be the right answer for anyone asking the same thing. Saved answers are collected to improve the assistant; nothing changes in the chat until a proposed improvement is approved.",
      "Never give clinical advice in the chat. If someone is in pain, ask them to call the practice or, out of hours, NHS 111.",
    ],
  },
  {
    id: "visitor-reply",
    title: "4. The visitor sees your reply",
    img: "04-visitor-sees-reply.webp",
    body: [
      "Your message shows in the visitor's chat with your name. While a conversation is with the team, the assistant stays quiet apart from a short “the team has your message” note, so the visitor can reply to you directly.",
      "Their answer appears at the bottom of the conversation on the handover page, which refreshes on its own, and the queue marks the chat “visitor replied”. Replying to a chat you have already released takes it back from the assistant.",
    ],
  },
  {
    id: "release",
    title: "5. Release the visitor back to the assistant",
    img: "05-release-to-assistant.webp",
    body: [
      "When you're finished, press Release to assistant. The assistant then answers the visitor's next questions again. If you don't release, the conversation stays with the team.",
      "Don't release straight after asking the visitor a question: their answer would go to the assistant instead of you. The page warns you when your last message was a question.",
    ],
  },
  {
    id: "conversations",
    title: "6. Review conversations and outcomes (admin)",
    img: "06-conversations.webp",
    body: [
      "Conversations lists every chat with its outcome, so you can see how the assistant is doing. Click the first message to open a conversation.",
      "Conversations opens on “To review”: chats nobody has looked at yet. Labelling a turn, or “Mark reviewed, nothing to fix” in the ledger, moves a chat out of the queue, and “Next to review →” takes you to the next one. Chats with problem labels wait under “Labelled, waiting for a fix” until a release addresses them; then mark the labels fixed (in the ledger, or for a whole label group in Insights) and they move to “Fixed in a release”. Changing a label or its note reopens it.",
      "Outcomes are confirmed when the visitor says thanks, finishes a booking or rates the chat 4–5 stars. Otherwise they're assumed after 24 hours without activity, and reversed if the visitor comes back about the same thing within 7 days.",
    ],
  },
  {
    id: "ledger",
    title: "7. Look inside a conversation (admin)",
    img: "07-turn-ledger.webp",
    body: [
      "The conversation inspector shows the chat on the left and the turn ledger on the right: for each visitor message, what the assistant decided to do, which page sections it found, which safety checks ran, and what it cost.",
      "Each turn reads left to right as a decision path: the safety check, who decided (the AI planner, or a named fixed rule such as “Opening hours” that answers without it), the commands, the sources with their scores, the checks that fired, and the reply with the quick replies it offered. The JSON is under “Raw details”.",
      "The flow map above the ledger shows each booking and handover step by step: the turns spent on each step (↺ when a step was asked again), greyed steps that were skipped, and where it ended, such as “Request sent” or “Stopped at Phone”. Click a turn number to open that turn.",
      "Personal details are stored as tokens such as ‹NAME_1›, exactly as the AI saw them. Use the ledger to see why an answer was wrong, then send the conversation link to the person who looks after the assistant's set-up.",
    ],
  },
];

const REASONS: [string, string][] = [
  ["emergency", "Possible emergency. Answer first; the visitor was told when to call 999."],
  ["pain_or_symptoms", "Pain, swelling, bleeding or an injury. Answer quickly."],
  ["clinical_advice", "Asked for advice on treatment or medicines. Don't advise in the chat; offer a call or appointment."],
  ["complaint", "A complaint or billing problem."],
  ["patient_record", "About their own records or appointments."],
  ["visitor_request", "Pressed “Talk to the practice” or asked for a person."],
  ["other", "Anything else the assistant couldn't help with."],
];

const OUTCOMES: [string, string][] = [
  ["resolved_by_bot", "The assistant answered and the visitor was satisfied."],
  ["resolved_after_handover", "The team replied and that settled it."],
  ["abandoned", "The visitor left without an answer, or came back with the same question."],
  ["escalated_unresolved", "Handed over but nobody replied, or the reply didn't settle it."],
  ["out_of_scope", "Asked about something unrelated to the practice."],
  ["blocked_by_guardrail", "A safety check stopped the answer, so the visitor got the phone number instead."],
];

function label(s: string) {
  return s.replace(/_/g, " ");
}

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Using the console</h1>
        <p className="text-slate-600">
          The console is where the practice team picks up chats the assistant hands over, calls back booking requests, and checks how the
          assistant is doing. A typical shift is the loop below.
        </p>
      </header>

      <section aria-label="Who uses what" className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Practice team</p>
          <p className="text-sm text-slate-700">
            <strong>Handovers</strong>: chats waiting for you, booking requests to call back, and contact details. <strong>Help</strong>: this
            page. That's all you need day to day.
          </p>
        </div>
        <div className="rounded-xl bg-violet-50 p-4 ring-1 ring-violet-100">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-violet-500">Admin</p>
          <p className="text-sm text-slate-700">
            <strong>Insights</strong>: turns grouped by what happened, with labelling. <strong>Conversations</strong>: every chat, filterable,
            with the turn ledger. For the platform owner, to review and improve the assistant.
          </p>
        </div>
      </section>

      <section aria-label="How a chat flows">
        <ol className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {FLOW.map((f, i) => (
            <li key={f.title} className="relative rounded-xl bg-white p-3 ring-1 ring-slate-200">
              <span className="mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-harbour-600 text-xs font-semibold text-white">{i + 1}</span>
              <p className="text-sm font-semibold text-slate-900">{f.title}</p>
              <p className="text-xs text-slate-500">{f.body}</p>
              {i < FLOW.length - 1 && (
                <span aria-hidden className="absolute -right-2.5 top-1/2 hidden -translate-y-1/2 text-slate-400 lg:block">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-slate-500">
          Most chats never reach step 3: the assistant answers them or takes a booking request, and they only appear under Conversations.
        </p>
      </section>

      <nav className="rounded-xl bg-white p-4 text-sm ring-1 ring-slate-200">
        <p className="mb-2 font-medium text-slate-900">Walkthrough</p>
        <ul className="grid gap-1 sm:grid-cols-2">
          {STEPS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-harbour-700 hover:underline">
                {s.title}
              </a>
            </li>
          ))}
          <li>
            <a href="#reference" className="text-harbour-700 hover:underline">
              Reference: reasons and outcomes
            </a>
          </li>
        </ul>
      </nav>

      {STEPS.map((s) => (
        <section key={s.id} id={s.id} className="scroll-mt-6 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">{s.title}</h2>
          {s.body.map((p) => (
            <p key={p} className="text-slate-700">
              {p}
            </p>
          ))}
          <img
            src={`/help/${s.img}`}
            alt={s.title}
            loading="lazy"
            width={1280}
            height={s.id === "ledger" ? 1000 : 800}
            className="w-full rounded-xl ring-1 ring-slate-200"
          />
        </section>
      ))}

      <section id="reference" className="scroll-mt-6 space-y-6">
        <h2 className="text-xl font-semibold text-slate-900">Reference</h2>
        <div>
          <h3 className="mb-2 font-semibold text-slate-900">Handover reasons</h3>
          <dl className="divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-slate-200">
            {REASONS.map(([k, v]) => (
              <div key={k} className="flex items-start gap-4 px-4 py-2.5">
                <dt className={`w-36 shrink-0 rounded-full px-2.5 py-0.5 text-center text-xs font-medium ${REASON_STYLE[k] ?? "bg-slate-100 text-slate-700"}`}>
                  {label(k)}
                </dt>
                <dd className="text-sm text-slate-700">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <h3 className="mb-2 font-semibold text-slate-900">Outcomes</h3>
          <dl className="divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-slate-200">
            {OUTCOMES.map(([k, v]) => (
              <div key={k} className="flex items-start gap-4 px-4 py-2.5">
                <dt className={`w-44 shrink-0 rounded-full px-2.5 py-0.5 text-center text-xs ring-1 ${OUTCOME_STYLE[k]}`}>{label(k)}</dt>
                <dd className="text-sm text-slate-700">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="text-sm text-slate-600">
          Questions about the assistant's answers? Open the conversation, check the turn ledger, and share the link with the person who looks after the assistant's set-up. <Link href="/console/handovers" className="text-harbour-700 hover:underline">Back to Handovers</Link>
        </p>
      </section>
    </div>
  );
}
