// supabase/functions/fetch-rates/index.ts
//
// Підтягує актуальні курси валют і зберігає їх у exchange_rates для
// користувача, що викликав функцію:
//   - фіат (USD, EUR, GBP, PLN) — офіційний курс НБУ, у гривнях;
//   - крипта (BTC, ETH, USDT) — курс у доларах з CoinGecko, далі
//     переводиться в гривні через щойно отриманий курс USD.
// Усе це перераховується відносно БАЗОВОЇ валюти користувача (profiles.
// base_currency) і зберігається як rate_to_base — саме той формат, який
// читає застосунок на екрані "Огляд" для картки "Загальний капітал".
//
// Викликається автоматично з клієнта (див. useCapital.ts), коли курси
// застаріли (>12 год), а також вручну кнопкою "Оновити курси зараз" у
// Профілі. Ручний запис курсу в Профілі й далі можливий, але наступне
// автооновлення його перезапише.
//
// Деплой: Supabase Dashboard → Edge Functions → Deploy a new function →
// Via Editor → назва "fetch-rates" → вставити цей код → Deploy function.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// код валюти в нашій БД -> код валюти в НБУ (однакові, окрім хіба що регістру)
const NBU_CODES = ['USD', 'EUR', 'GBP', 'PLN']
// код валюти в нашій БД -> id монети в CoinGecko
const COINGECKO_IDS: Record<string, string> = { BTC: 'bitcoin', ETH: 'ethereum', USDT: 'tether' }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Не авторизовано' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData.user) {
      return json({ error: 'Не вдалося підтвердити користувача' }, 401)
    }
    const userId = userData.user.id

    const { data: profile } = await userClient
      .from('profiles')
      .select('base_currency')
      .eq('id', userId)
      .single()
    const base = profile?.base_currency ?? 'UAH'

    // 1) Офіційні курси НБУ — скільки гривень за 1 одиницю валюти.
    const nbuRes = await fetch('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json')
    if (!nbuRes.ok) throw new Error(`НБУ API відповіло ${nbuRes.status}`)
    const nbuData: Array<{ cc: string; rate: number }> = await nbuRes.json()

    const uahPerUnit: Record<string, number> = { UAH: 1 }
    for (const code of NBU_CODES) {
      const found = nbuData.find(r => r.cc === code)
      if (found && found.rate > 0) uahPerUnit[code] = found.rate
    }
    if (!uahPerUnit.USD) throw new Error('НБУ не повернув курс USD — спробуй пізніше')

    // 2) Крипта в доларах з CoinGecko -> переводимо в гривні через курс USD.
    //    Якщо CoinGecko недоступний — просто пропускаємо крипту цього разу,
    //    фіатні курси з НБУ все одно запишуться.
    try {
      const ids = Object.values(COINGECKO_IDS).join(',')
      const cgRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`)
      if (cgRes.ok) {
        const cgData: Record<string, { usd: number }> = await cgRes.json()
        for (const [code, id] of Object.entries(COINGECKO_IDS)) {
          const usdPrice = cgData[id]?.usd
          if (usdPrice) uahPerUnit[code] = usdPrice * uahPerUnit.USD
        }
      }
    } catch {
      // ігноруємо — крипто-курси лишаться неоновленими до наступної спроби
    }

    if (!uahPerUnit[base]) {
      throw new Error(`Немає джерела курсу для базової валюти ${base}`)
    }

    // 3) Перераховуємо все відносно базової валюти користувача.
    const rows = Object.entries(uahPerUnit)
      .filter(([code]) => code !== base)
      .map(([code, uahValue]) => ({
        user_id: userId,
        currency: code,
        rate_to_base: uahValue / uahPerUnit[base],
      }))

    if (rows.length === 0) return json({ success: true, updated: [], base })

    const { error: upsertError } = await userClient
      .from('exchange_rates')
      .upsert(rows, { onConflict: 'user_id,currency' })
    if (upsertError) throw upsertError

    return json({ success: true, updated: rows.map(r => r.currency), base })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Невідома помилка' }, 500)
  }
})
