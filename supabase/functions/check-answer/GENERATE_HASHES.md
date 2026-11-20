# Generating answer hashes

The `contract_answers` table stores SHA-256 hashes of **normalized** answers,
never plain text. Normalize = `trim` + `lowercase` + collapse internal whitespace.

Compute a hash locally (any machine with Python):

```sh
python3 -c "import hashlib; print(hashlib.sha256('2021'.strip().lower().encode()).hexdigest())"
```

Or in the Supabase SQL editor:

```sql
select encode(digest(lower(trim('2021')), 'sha256'), 'hex');
```

Then in Supabase → Table Editor → `contract_answers`, insert:

| contract_slug | answer_hash | alias_hashes |
|---|---|---|
| ghost-domain | (hash of `2021`) | `[]` |

For aliases (accepted alternative spellings), add a separate hash string per alias
in the JSON array: `["hash1", "hash2"]`.

⚠️ Do hashes only in your own dashboard/terminal. Never paste answers or hashes
into chat, and never commit them to this repo.
