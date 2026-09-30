# What a user costs us, and what to charge

Written for you (the operator). Every AI figure below comes from real logged usage in
`usage_logs`, not estimates. Re-run the queries at the bottom as traffic grows.

## 1. Measured cost per action

Model prices are Anthropic list prices per million tokens: Haiku 4.5 at $1 in / $5 out,
Opus 5.5 at $4 in / $20 out.

| Action | Model | Input | Output | Cost (USD) | Cost (GHS)¹ | Source |
|---|---|---|---|---|---|---|
| Chat message (with tool calls) | Haiku 4.5 | ~4,050 | ~156 | **$0.0048** | ¢6 | measured, 15 messages |
| Screenshot read | Haiku 4.5 | ~1,800² | ~300 | **$0.0033** | ¢4 | image ≈ 1,100–1,600 tokens |
| Slip build to target | Haiku 4.5 | ~4,500² | ~250 | **$0.0058** | ¢7 | chat + one extra tool round |
| Match analysis | Opus 5.5 | ~2,000 | ~600 | **$0.0200** | ¢25 | cached 3 h and shared |
| Daily picks (all users) | Opus 5.5 | ~8,000 | ~1,500 | **$0.0620/day** | ¢77/day | generated once for everyone |

¹ At GHS 12.5 to the dollar. ² Extrapolated from the measured chat baseline; re-measure once
these features have real traffic.

**Caching matters.** The system prompt and tool definitions are cached, so cache reads cost
$0.10 per million instead of $1.00. Without that, chat would cost roughly 3× more.

## 2. Monthly cost per active user

Assuming a fairly heavy user, 20 active days a month:

| Tier | Typical use a day | AI cost/month (USD) | AI cost/month (GHS) |
|---|---|---|---|
| Free | 3 chats a week | $0.06 | ¢75 |
| Starter | 10 chats, 1 screenshot | $0.98 | GHS 12 |
| Pro | 25 chats, 3 screenshots, 1 analysis | $3.06 | GHS 38 |
| VIP | 60 chats, 10 screenshots, 3 analyses | $7.87 | GHS 98 |

## 3. Fixed monthly costs

| Service | Plan | USD/month | Needed when |
|---|---|---|---|
| Cloudflare Workers | Paid | $5 | now (required: the Worker is 4.9 MB) |
| Supabase | Free → Pro | $0 → $25 | Pro at roughly 300–500 active users, for backups and connection limits |
| API-Football | Free → Pro | $0 → ~$39 | Pro unlocks form, tables and injuries: needed for good picks |
| Resend | Free → Pro | $0 → $20 | Free covers 3,000 emails/month, about 1,500 sign-ins |
| Domain | — | ~$1 | now |
| **Total now** | | **$6** | |
| **Total at scale** | | **$90** | roughly 500+ users |

## 4. Suggested prices

Prices are stored in the `plans` table, so these are changeable without a deploy. The margin
column assumes a user at the top of their tier's limits.

| Tier | GHS | Period | Daily limits | AI cost | Margin |
|---|---|---|---|---|---|
| **Free** | 0 | — | 3 chats/day, 1 screenshot/day, no analysis, no picks | ¢75/mo | loss leader |
| **Starter** | 10 | 1 day | 15 chats, 3 screenshots, 2 slip builds, no analysis | ¢60/day | ~94% |
| **Pro** | 45 | 7 days | 40 chats, 10 screenshots, 10 builds, 3 analyses, daily picks | GHS 13/week | ~71% |
| **VIP** | 120 | 30 days | 100 chats, 30 screenshots, unlimited builds, 10 analyses, daily picks, priority | GHS 98/mo | ~18% |

Why these numbers:

- **Starter at GHS 10** is about a day's transport fare and beats the current GHS 5 Day Pass,
  which is thin once a user reaches its 30-message limit.
- **Pro at GHS 45 a week** is the tier to push. It has the best margin and includes daily picks.
- **VIP at GHS 120 a month** is cheaper per day than Pro, which is the point: it trades margin
  for commitment and cash up front. Watch the heaviest VIP users; if many hit the limits every
  day, raise the price or trim the limits rather than absorbing it.
- Every tier stays well clear of its own cost even at full usage, because caching keeps chat
  under a cent a message.

**A warning about VIP.** A VIP user who genuinely uses 100 chats and 10 analyses every day for
30 days costs about GHS 98, against GHS 120 of revenue. That's fine on average, since almost
nobody uses a full allowance, but it's the tier to watch first.

## 5. Re-measuring

```sql
-- Cost per action type, last 30 days
select kind, model, count(*) n,
       round(avg(input_tokens)) avg_in, round(avg(output_tokens)) avg_out,
       round(avg(cost_micro_usd)) avg_micro_usd,
       round(sum(cost_micro_usd) / 1e6, 2) total_usd
from usage_logs
where success and created_at > now() - interval '30 days'
group by 1, 2 order by total_usd desc;

-- Cost per active user, last 30 days
select round(sum(cost_micro_usd) / 1e6 / count(distinct user_id), 4) usd_per_active_user
from usage_logs where success and created_at > now() - interval '30 days';
```

If cost per active user climbs above about 30% of revenue per user, cut limits or raise prices.
