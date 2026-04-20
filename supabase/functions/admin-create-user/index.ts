import {
  assertActorCanManageUsers,
  assertScopedAccess,
  getAdminClient,
  jsonResponse,
  loadActorProfile,
  verifyFirebaseTokenFromRequest,
} from '../_shared/auth.ts'

type CreateUserBody = {
  email?: string
  password?: string
  username?: string
  fullName?: string
  mobile?: string
  role?: string
  isActive?: boolean
  substationId?: string | null
  allowDelete?: boolean
}

function normalizeRole(role: string | undefined) {
  const normalized = String(role || 'normal_user').trim().toLowerCase()
  if (normalized === 'admin') return 'super_admin'
  if (normalized === 'user') return 'normal_user'
  if (normalized === 'substation_user') return 'normal_user'
  return normalized
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  try {
    const actorToken = await verifyFirebaseTokenFromRequest(request)
    const actor = await loadActorProfile(actorToken.uid)
    assertActorCanManageUsers(actor)

    const body = (await request.json()) as CreateUserBody
    const role = normalizeRole(body.role)
    const substationId = body.substationId || null
    assertScopedAccess(actor, substationId, role)

    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    if (!email || password.length < 8) {
      return jsonResponse(400, { error: 'Valid email and password(min 8) required.' })
    }

    const firebaseWebApiKey = Deno.env.get('FIREBASE_WEB_API_KEY') || ''
    if (!firebaseWebApiKey) {
      throw new Error('FIREBASE_WEB_API_KEY missing.')
    }

    const createFirebaseResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseWebApiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
          returnSecureToken: false,
        }),
      },
    )

    const createFirebasePayload = await createFirebaseResponse.json()
    if (!createFirebaseResponse.ok || !createFirebasePayload?.localId) {
      return jsonResponse(400, {
        error: createFirebasePayload?.error?.message || 'Firebase create user failed.',
      })
    }

    const admin = getAdminClient()
    const profileRow = {
      firebase_uid: createFirebasePayload.localId,
      auth_user_id: createFirebasePayload.localId,
      email,
      username: body.username || email,
      full_name: body.fullName || '',
      mobile: body.mobile || '',
      role,
      is_active: body.isActive !== false,
      substation_id: substationId,
      module_permissions: {
        modules: {
          employees: {
            delete: Boolean(body.allowDelete),
          },
        },
      },
    }

    const { data: user, error } = await admin
      .from('profiles')
      .insert(profileRow)
      .select('*')
      .single()

    if (error) {
      return jsonResponse(400, { error: error.message })
    }

    return jsonResponse(200, {
      user,
      message: 'User created successfully.',
    })
  } catch (error) {
    return jsonResponse(401, {
      error: error instanceof Error ? error.message : 'Unauthorized request.',
    })
  }
})
