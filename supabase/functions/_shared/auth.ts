import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type FirebaseLookupResponse = {
  users?: Array<{
    localId: string
    email?: string
  }>
}

export type ActorProfile = {
  id: string
  role: string
  substation_id: string | null
  firebase_uid: string | null
  auth_user_id: string | null
}

export function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

export function getAdminClient() {
  const url = Deno.env.get('SUPABASE_URL') || ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!url || !key) {
    throw new Error('Supabase service role env missing.')
  }
  return createClient(url, key)
}

export async function verifyFirebaseTokenFromRequest(request: Request) {
  const authHeader = request.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) {
    throw new Error('Missing bearer token.')
  }

  const firebaseWebApiKey = Deno.env.get('FIREBASE_WEB_API_KEY') || ''
  if (!firebaseWebApiKey) {
    throw new Error('FIREBASE_WEB_API_KEY missing.')
  }

  const verifyResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseWebApiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ idToken: token }),
    },
  )

  if (!verifyResponse.ok) {
    throw new Error('Invalid Firebase token.')
  }

  const verifyPayload = (await verifyResponse.json()) as FirebaseLookupResponse
  const firebaseUser = verifyPayload.users?.[0]
  if (!firebaseUser?.localId) {
    throw new Error('Firebase user not found for token.')
  }

  return {
    uid: firebaseUser.localId,
    email: firebaseUser.email || '',
  }
}

export async function loadActorProfile(uid: string) {
  const admin = getAdminClient()
  const byFirebase = await admin
    .from('profiles')
    .select('id, role, substation_id, firebase_uid, auth_user_id')
    .eq('firebase_uid', uid)
    .maybeSingle()

  if (byFirebase.error) {
    throw new Error(byFirebase.error.message)
  }

  if (byFirebase.data) {
    return byFirebase.data as ActorProfile
  }

  const byAuthUser = await admin
    .from('profiles')
    .select('id, role, substation_id, firebase_uid, auth_user_id')
    .eq('auth_user_id', uid)
    .maybeSingle()

  if (byAuthUser.error) {
    const message = String(byAuthUser.error.message || '')
    if (
      String(byAuthUser.error.code || '') === '22P02' &&
      message.toLowerCase().includes('invalid input syntax for type bigint')
    ) {
      // Legacy schema mismatch: auth_user_id is numeric in some environments.
      throw new Error('profiles.auth_user_id type mismatch. Run auth_user_id text migration.')
    }
    throw new Error(message)
  }

  if (!byAuthUser.data) {
    throw new Error('Actor profile missing.')
  }

  return byAuthUser.data as ActorProfile
}

export function assertActorCanManageUsers(actor: ActorProfile) {
  if (actor.role !== 'super_admin' && actor.role !== 'substation_admin') {
    throw new Error('Only admins can manage users.')
  }
}

export function assertScopedAccess(
  actor: ActorProfile,
  targetSubstationId: string | null | undefined,
  targetRole: string,
) {
  if (actor.role === 'super_admin') {
    return
  }

  if (actor.role !== 'substation_admin') {
    throw new Error('Only admins can manage users.')
  }

  if (targetRole === 'super_admin' || targetRole === 'substation_admin') {
    throw new Error('Substation Admin cannot manage admin roles.')
  }

  if (!actor.substation_id || actor.substation_id !== (targetSubstationId || null)) {
    throw new Error('Cannot manage user outside assigned substation.')
  }
}
