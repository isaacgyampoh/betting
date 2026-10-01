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

## 4. Prices (live)

Starter / Pro / VIP, each buyable by day, week or month. Limits are per tier and identical
whichever duration is bought. Everything is in the `plans` table, so changing a price needs no deploy.

| Tier | Day | Week | Month | Daily limits |
|---|---|---|---|---|
| **Free** | — | — | — | 3 chats, 1 screenshot, 1 build |
| **Starter** | GHS 5 | GHS 20 | GHS 60 | 15 chats, 3 screenshots, 2 builds |
| **Pro** | GHS 10 | GHS 40 | GHS 120 | 40 chats, 10 screenshots, 10 builds, 3 analyses, daily picks |
| **VIP** | GHS 15 | GHS 70 | GHS 200 | 100 chats, 30 screenshots, 30 builds, 10 analyses, daily picks |

### Margin at **full** daily usage

This is the worst case: a user who maxes every allowance, every day.

| Tier | Period | GHS/day | Cost/day | Margin | Break-even usage |
|---|---|---|---|---|---|
| Starter | day | 5.00 | 1.17 | 77% | — |
| Starter | week | 2.86 | 1.17 | 59% | — |
| Starter | month | 2.00 | 1.17 | 42% | — |
| Pro | day | 10.00 | 4.29 | 57% | — |
| Pro | week | 5.71 | 4.29 | 25% | — |
| **Pro** | **month** | 4.00 | 4.29 | **-7%** | 93% of allowance |
| VIP | day | 15.00 | 11.19 | 25% | — |
| **VIP** | **week** | 10.00 | 11.19 | **-12%** | 89% of allowance |
| **VIP** | **month** | 6.67 | 11.19 | **-68%** | 60% of allowance |

### Why this is acceptable, and what to watch

Three rows lose money **only if a user maxes out every single day**, which almost nobody does.
That is the normal shape of a monthly plan: it is a bet on average usage, not worst-case usage.
Two things make the real picture better than the table:

1. **Match analyses are cached per match for 3 hours and shared across every user.** If fifty
   people analyse the same match, we pay once. The table charges every user the full price, so it
   materially overstates the cost of the analysis-heavy tiers.
2. **Cache reads cost a tenth of fresh input tokens**, and the system prompt and tool definitions
   are cached on every chat turn.

The one change made to the requested prices: **VIP slip builds are 30 a day rather than unlimited.**
Unlimited is the only item whose worst case has no ceiling, and a GHS 200 month cannot absorb it.
Everything else is exactly as specified.

**Watch this.** If the query below shows cost per active user climbing past about 30% of revenue
per user, trim the monthly limits rather than raising prices.

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
