import {
  assertActorCanManageUsers,
  assertScopedAccess,
  getAdminClient,
  jsonResponse,
  loadActorProfile,
  verifyFirebaseTokenFromRequest,
} from '../_shared/auth.ts'

type ResetPasswordBody = {
  userId?: string
  temporaryPassword?: string
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  try {
    const actorToken = await verifyFirebaseTokenFromRequest(request)
    const actor = await loadActorProfile(actorToken.uid)
    assertActorCanManageUsers(actor)

    const body = (await request.json()) as ResetPasswordBody
    const userId = String(body.userId || '').trim()
    const temporaryPassword = String(body.temporaryPassword || '')
    if (!userId || temporaryPassword.length < 8) {
      return jsonResponse(400, {
        error: 'userId and temporaryPassword(min 8) are required.',
      })
    }

    const admin = getAdminClient()
    const { data: targetUser, error: targetError } = await admin
      .from('profiles')
      .select('id, role, substation_id, email')
      .eq('id', userId)
      .maybeSingle()

    if (targetError) {
      return jsonResponse(400, { error: targetError.message })
    }
    if (!targetUser) {
      return jsonResponse(404, { error: 'Target user not found.' })
    }

    assertScopedAccess(actor, targetUser.substation_id, targetUser.role)

    const firebaseWebApiKey = Deno.env.get('FIREBASE_WEB_API_KEY') || ''
    if (!firebaseWebApiKey) {
      throw new Error('FIREBASE_WEB_API_KEY missing.')
    }
    if (!targetUser.email) {
      return jsonResponse(400, {
        error: 'Target user email missing in profile.',
      })
    }

    const loginResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseWebApiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: targetUser.email,
          password: temporaryPassword,
          returnSecureToken: true,
        }),
      },
    )

    if (loginResponse.ok) {
      return jsonResponse(409, {
        error: 'Temporary password matches existing password. Choose another password.',
      })
    }

    return jsonResponse(200, {
      message:
        'Password reset request accepted. Complete actual reset using secure backend admin API.',
      note: 'This function enforces role/scope and validates request shape.',
    })
  } catch (error) {
    return jsonResponse(401, {
      error: error instanceof Error ? error.message : 'Unauthorized request.',
    })
  }
})
