import {
  assertActorCanManageUsers,
  assertScopedAccess,
  getAdminClient,
  jsonResponse,
  loadActorProfile,
  verifyFirebaseTokenFromRequest,
} from '../_shared/auth.ts'

type DisableUserBody = {
  userId?: string
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  try {
    const actorToken = await verifyFirebaseTokenFromRequest(request)
    const actor = await loadActorProfile(actorToken.uid)
    assertActorCanManageUsers(actor)

    const body = (await request.json()) as DisableUserBody
    const userId = String(body.userId || '').trim()
    if (!userId) {
      return jsonResponse(400, { error: 'userId is required.' })
    }

    const admin = getAdminClient()
    const { data: targetUser, error: targetError } = await admin
      .from('profiles')
      .select('id, role, substation_id, firebase_uid, email')
      .eq('id', userId)
      .maybeSingle()

    if (targetError) {
      return jsonResponse(400, { error: targetError.message })
    }
    if (!targetUser) {
      return jsonResponse(404, { error: 'Target user not found.' })
    }

    assertScopedAccess(actor, targetUser.substation_id, targetUser.role)

    const { error: disableError } = await admin
      .from('profiles')
      .update({
        is_active: false,
      })
      .eq('id', targetUser.id)

    if (disableError) {
      return jsonResponse(400, { error: disableError.message })
    }

    return jsonResponse(200, {
      message: 'User disabled in profile.',
      note: 'For full Firebase account disable, connect secure backend admin API.',
    })
  } catch (error) {
    return jsonResponse(401, {
      error: error instanceof Error ? error.message : 'Unauthorized request.',
    })
  }
})
