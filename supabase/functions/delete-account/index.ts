// supabase/functions/delete-account/index.ts
//
// Повністю видаляє акаунт користувача, що викликав функцію: спочатку
// прибирає його файли у Storage (якщо є — на майбутнє, зараз завантаження
// файлів ще не реалізоване), потім видаляє сам логін в auth.users.
//
// Усі таблиці мають "on delete cascade" від auth.users(id), тож видалення
// логіна автоматично й атомарно видаляє всі пов'язані дані: рахунки,
// операції, категорії, борги, курси валют і профіль. Після цього той самий
// email повністю вільний — можна зареєструватись на нього знову як вперше.
//
// Деплой: Supabase Dashboard → Edge Functions → Deploy a new function →
// Via Editor → назва "delete-account" → вставити цей код → Deploy function.
// Жодних додаткових секретів вручну задавати не треба — SUPABASE_URL,
// SUPABASE_ANON_KEY і SUPABASE_SERVICE_ROLE_KEY доступні автоматично.

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Не авторизовано' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    // Клієнт від імені користувача, який робить запит — щоб дізнатись, ХТО це.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData.user) {
      return json({ error: 'Не вдалося підтвердити користувача' }, 401)
    }
    const userId = userData.user.id

    // Адмін-клієнт із service_role — існує тільки тут, на сервері,
    // ніколи не потрапляє у браузер.
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    // На випадок майбутніх файлів у Storage — прибираємо, щоб видалення
    // користувача не впало через прив'язані об'єкти.
    const { data: files } = await adminClient.storage.from('attachments').list(userId)
    if (files && files.length > 0) {
      await adminClient.storage.from('attachments').remove(files.map(f => `${userId}/${f.name}`))
    }

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId, { shouldSoftDelete: false })
    if (deleteError) return json({ error: deleteError.message }, 500)

    return json({ success: true })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Невідома помилка' }, 500)
  }
})
