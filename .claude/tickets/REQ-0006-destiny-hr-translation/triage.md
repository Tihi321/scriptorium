# REQ-0006 triage of flagged chunks

## Book 1: what-fate-decides-luck-will-and-the-life-hr-54a317

Flagged during the run: 1. Triage lines: 1.

- chunk 5 (d4.2) | reason: QA (Gemini) major "addition": after the fix pass the text read "Mojre, božice sudbine, na engleskom poznate kao the Fates" and "božice sudbine" is not in the source | action: edit_chunk to "Mojre, na engleskom poznate kao the Fates [6]." (literal, as the source; the gloss was mine). Chunk now done.

Fix passes Gemini triggered (major issues, answered as fixer, not flagged afterwards):
- chunk 4 (d3.7) "proći jedan test" could read as "pass a test": changed to "biti podvrgnut jednoj provjeri". Agreed with Gemini.
- chunk 5 (d4.2) "poznate i kao božice sudbine" dropped "known in English as the Fates": fixed, then flagged as above.

Minor QA issues left as they are (judged, not edited):
- chunk 1 (m.2) "Jednome ... Drugome": Gemini wants "Jednoj" because the first child is a girl; the blurb does not say which child, generic "jednome" is correct. Accepted.
- "will" glossary row matched the English future "will" in chunks 5, 6, 7, 9, 10, 11 (false positives; no noun "will" there).
- chunk 4 "chance" (numeric chance rendered "vjerojatnost" per the glossary note), chunk 6 "destiny" (rendered "božansko određenje" per the note), chunk 9 "South Seas" (inflected "Južnim morima"), chunk 11 "Stoics" (genitive "stoika"): correct Croatian, accepted.
- chunk 12 (References): 20 glossary hits on English source titles, which the brief keeps in English. Accepted.

## Book 2: the-tide-table-hr-fc6ee3

Flagged during the run: 1. Triage lines: 1.

- chunk 14 (d8.4, Contents) | reason: QA (Gemini) major "tags": "Missing inline tags <1> and </1>", suggestion `<1>Regata</1>`; the translation already was `<1>Regata</1>` (false positive; the fix pass returned it unchanged and the chunk was flagged) | action: edit_chunk with the same text (accepted), then retry_chunk with the same text so Gemini scored it again: 10, no major issue. Chunk now done.

Edited after QA (not flagged):
- chunk 7 (d4.20) Gemini minor "mistranslation": „Onda mesti.“ used the infinitive; the imperative is „Onda meti.“ Agreed: edit_chunk, then retry_chunk with the corrected text so the chunk is scored again (9, minors only).

Minor QA issues left as they are (judged, not edited):
- "tide" => "morska mijena" in 13 chunks: the glossary note itself says generic "the tide" is voda / plima by context, and "tide table" is "tablica plime i oseke". Correct as written.
- "sea wall" => "obalni nasip": the short form "nasip" (allowed by the glossary note) is used after the first mention. Correct.
- "estuary" (d3.2 "s ušća", d3.26 "s ušća"), "low water" (d4.18 "za niske vode"), "flood" (d7.11, "flood warnings" = "upozorenja na poplave", not the rising tide): inflected or a different sense, correct.
- "chance" (d4.10 "gave himself no chance" = "nije si davao nikakve izglede"): not the concept "chance", correct.
- "cottage hospital" => "mala bolnica" (m.2 "male bolnice", genitive): correct.
- "clinker dinghy" => glossary "čamac na preklop"; text uses "čamac s preklopnom oplatom" (chunks 7, 8, 12), the exact boatbuilding term; kept, consistent in the whole book.
- "Pellow's" => glossary "Pellowljevo brodogradilište"; text uses "Pellowovo / Pellowova brodogradilišta" (chunks 6, 8, 10), the regular possessive of a name ending in -ow; kept, consistent in the whole book. The glossary row is the one that is off.

Book 1 note (2026-11-10): the triage edit_chunk of chunk 5 had cleared its QA score (book 1 showed 12/13 scored, 9.9). retry_chunk with the same final text: Gemini scored it 10 (one false "will" minor). Book 1 is now 13/13 scored, 9.9, and was exported again.
