---
id: "0005"
title: What should "Teach me" produce before you decide a card?
status: open
kind: choice
priority: normal
created: 2026-11-11T13:22:05Z
created_by: claude (batch-1 writer)
tags: [pr-2, chat, teach-me, learning]
depends_on: []
recommendation:
  option: worked
  why: >-
    You want to understand a decision well enough to make it, in minutes. Running the options
    side by side through one concrete scenario is what the contrasting-cases and
    worked-example research supports for people new to a topic, and it lands directly on the
    choice in front of you. Opening with one prediction question is cheap and has its own
    evidence. Pick socratic if you want to build lasting expertise in an area rather than
    decide this one card.
options:
  - id: explainer
    title: A short explainer
    summary: About 300 words of background (the concepts, the vocabulary, why the question is hard), written for someone who hasn't seen the code, then back to the card.
    pros:
      - Fastest to produce and to read; a familiar format
      - Fills vocabulary gaps (what a merge driver is, what dontAsk mode means) that block reading the card at all
    cons:
      - Reading is passive; reviews of study techniques rate rereading and summaries low for lasting learning
      - Easy to feel you understood without being able to apply it to the options (the illusion of explanatory depth)
  - id: socratic
    title: A Socratic back-and-forth
    summary: The agent asks you a short series of questions about the problem and the options, gives hints rather than answers, and explains only once you've tried.
    pros:
      - Active, interactive engagement, which the ICAP framework ranks highest for learning
      - Finds exactly what you don't know instead of explaining what you do
      - A well-designed AI tutor has beaten in-class active learning in a randomized trial
    cons:
      - The slowest; several rounds per card, when you may just want enough to decide
      - Only works if the tutor holds back answers; the same model without those guardrails measurably hurt learning in one large study
  - id: worked
    title: A worked example comparing the options
    summary: The agent picks one realistic scenario from this project, asks you to predict which option handles it better, then walks each option through it step by step and points out where they differ.
    pros:
      - Ties the background straight to the decision; you see the options behave, not only described
      - Comparing cases side by side before an explanation helps people notice the features that matter
      - Worked examples are one of the best-supported formats for people new to a topic
    cons:
      - One scenario can mislead if it isn't representative; the agent must say what it leaves out
      - Less useful when you already know the area well (worked examples lose their edge, even hurt, as expertise grows)
      - Takes longer to write than an explainer, and needs the agent to reason about this project's code
  - id: sources
    title: Curated primary sources
    summary: Three to five primary sources (official docs, papers, specs), each with the passage that matters quoted and one line on why it matters for this card.
    pros:
      - You judge the evidence yourself, not the agent's paraphrase
      - Trustworthy and checkable; overlaps with More info / research
    cons:
      - The slowest path to understanding for a newcomer; you do the synthesis
      - Primary sources rarely address your exact decision, so the link to the options is left to you
---

## Context

PR 2 adds a **Teach me** button to each card's conversation with the agent (see #0002 to #0004).
`docs/foundations.md` lists it as a must-have: on any card you can "ask to be **taught** the
background before deciding". You have said you want to be educated before deciding, but also
to decide quickly. Today nothing exists: `src/web/components/CardAssistant.tsx` is a
placeholder.

This card is about what the first answer to *Teach me* looks like. Any format can be followed by
questions in the same conversation, and *More info / research* is a separate button.

**What the research says** (sources below):

- **Worked examples** help people new to a topic more than solving problems themselves (Sweller
  & Cooper 1985; Sweller, van Merriënboer & Paas 1998, 2019), and the advantage fades and can
  reverse as expertise grows (the expertise reversal effect, Kalyuga et al. 2003).
- **Contrasting cases**: analysing cases side by side and then being told the explanation beat
  reading about the distinctions or summarizing a text. "Noticing the distinctions between
  contrasting cases creates a 'time for telling'" (Schwartz & Bransford 1998).
- **Pre-questions**: trying to answer before being taught improves learning, even when the
  attempt fails, as long as the answer follows (Richland, Kornell & Kao 2009; review in Pan &
  Carpenter 2023).
- **Passive formats**: a large review of study techniques rates practice testing and distributed
  practice high, and "summarization, highlighting, the keyword mnemonic, imagery use for text
  learning, and rereading" low (Dunlosky et al. 2013). Those are techniques a learner applies, not
  explainer formats, so this is indirect evidence.
- **AI tutoring**: a tutor designed around good pedagogy beat in-class active learning in a
  randomized trial (Kestin et al. 2025), while a plain chatbot ("GPT Base") improved practice
  scores but lowered exam scores by 17% once access was removed; a version with tutor guardrails largely avoided the
  harm (Bastani et al. 2025). ICAP ranks interactive above constructive, active and passive
  engagement (Chi & Wylie 2014).
- **Explaining how something works** reduces people's overconfidence in their understanding,
  where listing reasons does not (Fernbach et al. 2013).

Example card for every option below: #0001 (who commits and pushes your answers).

## Option explainer: A short explainer

> **Background: how git merges a card.** Git merges files line by line. When two machines change
> different lines of a card, git combines them. When both change the same lines (for example,
> both append a note at the end of `feedback:`), git can't choose and writes both versions between
> `<<<<<<<` and `>>>>>>>` markers... (about 300 words, then: "Back to the card.")

## Option socratic: A Socratic back-and-forth

> **Agent:** Suppose you add a note to card 0007 on the laptop and another on the desktop, and
> both get pushed. What do you expect the card file to look like after the second pull?
>
> **You:** Both notes?
>
> **Agent:** That's what you'd want. Here's a hint: git compares lines, and both notes were
> added after the same line. What might git do when two changes start at the same place?

## Option worked: A worked example comparing the options

> **First, a guess:** you decide 6 cards on the laptop tonight, and tomorrow an agent on the
> desktop applies two of them. Which option leaves you with the fewest steps and no conflict?
>
> **The scenario, option by option:**
>
> | Step | auto | sync | agents | manual |
> |---|---|---|---|---|
> | 6 decisions on laptop | 6 commits, pushed | 0 commits yet | nothing | nothing |
> | Leave laptop | done | press Sync: 1 commit | answers stay on laptop | you must commit and push |
> | Desktop agent pulls | has all 6 | has all 6 | has none | has all 6 if you did |
>
> **What made the difference:** whether git runs at the moment you act or at a moment you choose,
> and who is around when a push fails. **What this leaves out:** conflicts, which need a second
> scenario where both machines touch one card.

## Option sources: Curated primary sources

> 1. **git-commit `--only`**: "Make a commit by taking the updated working tree contents of the
>    paths specified on the command line, disregarding any contents that have been staged for
>    other paths." Why it matters: the hub could commit one card without touching an agent's
>    staged work. https://git-scm.com/docs/git-commit
> 2. **git-pull `--autostash`**: "...use with care: the final stash application after a
>    successful merge might result in non-trivial conflicts." Why it matters: a Sync button
>    can't assume a clean tree. https://git-scm.com/docs/git-pull
> 3. (one or two more, each with its quote and why it matters)

## Sources

- Sweller, J. & Cooper, G. A. (1985). The use of worked examples as a substitute for problem
  solving in learning algebra. *Cognition and Instruction*, 2(1), 59–89.
  https://doi.org/10.1207/s1532690xci0201_3
- Sweller, J., van Merriënboer, J. J. G. & Paas, F. (2019). Cognitive architecture and
  instructional design: 20 years later. *Educational Psychology Review*, 31, 261–292 (open
  access). https://doi.org/10.1007/s10648-019-09465-5
- Kalyuga, S., Ayres, P., Chandler, P. & Sweller, J. (2003). The expertise reversal effect.
  *Educational Psychologist*, 38(1), 23–31. https://doi.org/10.1207/S15326985EP3801_4
- Schwartz, D. L. & Bransford, J. D. (1998). A time for telling. *Cognition and Instruction*,
  16(4), 475–522. https://doi.org/10.1207/s1532690xci1604_4 — "Noticing the distinctions
  between contrasting cases creates a 'time for telling'; learners are prepared to be told the
  significance of the distinctions they have discovered."
- Richland, L. E., Kornell, N. & Kao, L. S. (2009). The pretesting effect: Do unsuccessful
  retrieval attempts enhance learning? *Journal of Experimental Psychology: Applied*, 15(3),
  243–257. https://doi.org/10.1037/a0016496 — performance was better "in all experiments—a
  pretesting effect—even though only items that were not successfully retrieved on the pretest
  were analyzed."
- Pan, S. C. & Carpenter, S. K. (2023). Prequestioning and pretesting effects: A review of
  empirical research, theoretical perspectives, and implications for educational practice.
  *Educational Psychology Review*, 35, 97 (open access).
  https://doi.org/10.1007/s10648-023-09814-5
- Dunlosky, J., Rawson, K. A., Marsh, E. J., Nathan, M. J. & Willingham, D. T. (2013). Improving
  students' learning with effective learning techniques. *Psychological Science in the Public
  Interest*, 14(1), 4–58. https://doi.org/10.1177/1529100612453266 — "Practice testing and
  distributed practice received high utility assessments."
- Bastani, H. et al. (2025). Generative AI without guardrails can harm learning: Evidence from
  high school mathematics. *PNAS*, 122(26), e2422633122.
  https://doi.org/10.1073/pnas.2422633122 — "17% reduction in grades for GPT Base", harms
  "largely mitigated by the safeguards in GPT Tutor".
- Kestin, G., Miller, K., Klales, A., Milbourne, T. & Ponti, G. (2025). AI tutoring outperforms
  in-class active learning. *Scientific Reports*, 15, 17458.
  https://doi.org/10.1038/s41598-025-97652-6 — "students learn significantly more in less time
  when using the AI tutor, compared with the in-class active learning."
- Chi, M. T. H. & Wylie, R. (2014). The ICAP framework: Linking cognitive engagement to active
  learning outcomes. *Educational Psychologist*, 49(4), 219–243.
  https://doi.org/10.1080/00461520.2014.965823
- Fernbach, P. M., Rogers, T., Fox, C. R. & Sloman, S. A. (2013). Political extremism is
  supported by an illusion of understanding. *Psychological Science*, 24(6), 939–946.
  https://doi.org/10.1177/0956797612464058
