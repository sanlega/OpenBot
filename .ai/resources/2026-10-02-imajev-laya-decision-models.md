# Image decision models (ImaJev, Jev-Omni) and Laya as a Jev replacement: research note

_2026-10-02. Prompted by the owner: Sam Witteveen's video "Image Decision Models for RPA: Forms,
Scans and Screenshots" (youtube.com/watch?v=L8YxigQoLaM), and "investigate LAYA as a
replacement for Jev"._

## What OpenBot asks Jev today

These counts come from the dev machine's `decisions` table on 2026-10-02:

| Purpose | Decisions | Notes |
| --- | --- | --- |
| `computer` | 468 | The fast observe→decide→act loop: one `choice` among up to 24 element candidates plus about 6 fixed actions (around 30 options), over a DOM/AX text observation. |
| `risk` | 28 | Gates. |
| `route` | 12 | `choice` over about 10 engine:model pairs plus a `score`. |
| `notify` | 5 | Gates. |
| `loop` | 3 | Gates. |
| `spawn` | 2 | `noul` questions plus a `choice`. |

The Jev client already takes a base URL (`JEV_BASE_URL`). The table keeps only `state_hash`, not
the state itself, so past decisions cannot be replayed against another model as they are.

## ImaJev (`mohit67890/imajev-4b`), the model in the video

- **What it is:** a LoRA on Qwen3.5-4B with a 256-code decision readout (255 options plus
  `unknown`). Apache-2.0.
- **Interface:** Jev's `POST /v1/systemone`, extended with 0 to 2 `images`, `unknown_probability`
  and `abstained`.
- **Strengths:** reads screenshots, forms and photos against a record. On held-out constructed
  screenshot decisions it scores 95.6%. It also has a trained "can't tell".
- **Accuracy:**
  - JevBench public hard: 72.1%.
  - DecisionBench #3 of 60.
  - Atlan Decision Bench: 86.6% (Jev 1.13 scores 92.4% on the same board).
- **Latency:** 96 ms on an H100, about 1.15 s on a Mac Studio.
- **Limits:**
  - 32 KB state, 4,096 tokens and 1 to 8 questions per request.
  - English only.
  - Two-image comparison is weak (41.8%).
  - Runs only with MLX on a Mac or PyTorch on a GPU. There is no CPU path for our Windows users.
- **Fit for OpenBot:** the computer loop decides from DOM/AX text and fails on what the text does
  not show: canvas apps, images, CAPTCHAs, and whether an action visibly worked. A screenshot
  verification step ("did the page change as intended?", "is this a sign-in wall?") is exactly
  ImaJev's shape.
- **Recommendation:** an optional local "visual check" provider for users with a Mac or a GPU. It
  is a complement, not the main decision model.

## Jev-Omni (`akhilaaa3/Jev-Omni`)

- **What it is:** Gemma 4 12B; decides over text, image, audio and video. Apache-2.0.
- **Accuracy:** 86% on JevBench matched items.
- **Requirements:** a CUDA GPU and about 50 GB in FP32.
- **Fit for OpenBot:** not viable on a desktop app. Only on a server edition with a GPU.

## Laya (`convaiinnovations/laya`, Convai Innovations, Apache-2.0)

- **What it is:** ModernBERT-large (421M) or mmBERT-base (322M), with a typed decision head trained
  with RL against proper scoring rules. A router sends non-English text to the multilingual
  checkpoint.
- **Interface:** `laya-serve` exposes the same `POST /v1/systemone`, so swapping in is a base URL
  change. Unsloth Desktop also serves it on Mac, Windows and Linux, on CPU or GPU.

**For it:**
- Free and offline: data never leaves the computer.
- 100+ languages (our owner writes in Spanish).
- About 33 ms on a T4 GPU and 0.2 to 0.5 s on a good CPU.
- Calibrated, once the temperature is refitted on your own data.

**Against it, for our use:**
- **Weak zero-shot.** On typed-decisions, the base checkpoint scores 0.362 against Jev's 0.727.
  The 0.766 headline needs fine-tuning on that benchmark's own training split. On the Atlan board,
  Laya scores 52.8% against Jev's 92.4%. The card says so itself: "a fast base to specialise,
  not a zero-shot decision engine".
- **Many options degrade it.** Options share a fixed token budget, and quality drops past about
  20 (Banking77: 0.425 vs Jev's 0.870). Our main use, the computer `action` choice, has up to
  about 30 options and is 96% of our decisions.
- **Short context.** 512 tokens on English and 1,024 on multilingual, against Jev's 32k. Our
  computer observations and roster states would be cut off.
- **Thresholds do not transfer.** `confidence` is computed differently, so every band we tuned on
  Jev (spawn, risk, computer) would need re-tuning.
- **Calibration takes work.** Raw ECE is 0.466 and only reaches 0.081 after a per-type
  temperature fit.
- **CPU varies.** One VPS review measured a 49 s median on a weak 4 vCPU box.

## Recommendation

**Do not replace Jev.** Make the decision provider swappable and measure:

1. **Store what each decision saw.** Record the state (or a redacted copy) next to each decision,
   so a recorded week can be replayed against Laya or ImaJev and compared with Jev's answers and
   with what happened next.
2. **Settings > Jev: a provider choice.** Offer TypeSafe Jev (default), a local Jev-compatible
   server (Laya through Unsloth or `laya-serve`, ImaJev), and a URL. Each provider has its own
   thresholds.
3. **Hybrid routing by question shape:**
   - Local provider: short `noul` and few-option gates (spawn, notify, risk, loop), for privacy
     and zero cost.
   - Jev: wide `choice` questions (computer actions, routing).
   - Optional visual check: ImaJev, when the machine can run it.
4. **Use Laya alone only if the owner wants offline/no-account mode,** and then fine-tune it on
   OpenBot's own recorded decisions with Laya's Kaggle notebook (about 4 h on two free T4s).

Sources: the video description and chapters; the Hugging Face model cards of imajev-4b, Jev-Omni
and laya (read 2026-10-02); flowtivity.ai's hands-on review (2026-09-21); Unsloth's
decision-model docs.
