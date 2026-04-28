function toId(value) {
  return String(value || '').trim()
}

export function normalizeAccessRole(role) {
  const normalized = String(role || '').trim().toLowerCase().replace(/\s+/g, '_')
  if (
    normalized === 'owner' ||
    normalized === 'main_admin' ||
    normalized === 'super_admin' ||
    normalized.includes('super_admin')
  ) {
    return 'super_admin'
  }
  if (
    normalized === 'substation_admin' ||
    normalized.includes('substation_admin') ||
    normalized === 'admin'
  ) {
    return 'substation_admin'
  }
  if (normalized === 'user' || normalized === 'substation_user' || normalized === 'normal_user') {
    return 'substation_user'
  }
  return normalized || 'substation_user'
}

export function resolveProfileIds(profile) {
  return {
    profileId: toId(profile?.id || profile?.profile_id),
    authUserId: toId(profile?.auth_user_id || profile?.authUserId || profile?.firebase_uid),
    substationId: toId(profile?.substation_id || profile?.substationId),
    email: toId(profile?.email).toLowerCase(),
  }
}

function isOwnedBySubstationAdmin(substation, ids) {
  const candidates = [
    substation?.created_by_profile_id,
    substation?.createdByProfileId,
    substation?.created_by,
    substation?.createdBy,
    substation?.parent_admin_id,
    substation?.parentAdminId,
    substation?.admin_profile_id,
    substation?.adminProfileId,
    substation?.owner_profile_id,
    substation?.ownerProfileId,
    substation?.created_by_auth_user_id,
    substation?.createdByAuthUserId,
    substation?.created_by_user_id,
    substation?.createdByUserId,
    substation?.created_by_email,
    substation?.createdByEmail,
  ]
    .map(toId)
    .filter(Boolean)
  return candidates.includes(ids.profileId) || candidates.includes(ids.authUserId) || candidates.includes(ids.email)
}

export function getAllowedSubstationIdsForUser({
  profile,
  substations = [],
  mappings = [],
}) {
  if (!profile) return []
  const role = normalizeAccessRole(profile?.role)
  const ids = resolveProfileIds(profile)

  if (role === 'super_admin') {
    return null
  }

  const fromMappings = (mappings || [])
    .filter((item) => {
      const userId = toId(item?.userId || item?.user_id || item?.profile_id || item?.auth_user_id)
      if (!userId) {
        return false
      }
      const matchesProfileId = ids.profileId && userId === ids.profileId
      const matchesAuthUserId = ids.authUserId && userId === ids.authUserId
      return Boolean(matchesProfileId || matchesAuthUserId)
    })
    .map((item) => toId(item?.substationId || item?.substation_id))
    .filter(Boolean)

  if (role === 'substation_admin') {
    const ownedSubstations = (substations || [])
      .filter((substation) => isOwnedBySubstationAdmin(substation, ids))
      .map((substation) => toId(substation?.id))
      .filter(Boolean)
    // Business rule: substation admins can access only self-created/owned substations.
    // Explicit user mappings are for substation users, not admin scope expansion.
    return Array.from(new Set(ownedSubstations.filter(Boolean)))
  }

  return Array.from(new Set([ids.substationId, ...fromMappings].filter(Boolean)))
}

export function getAllowedSubstationsForUser({
  profile,
  substations = [],
  mappings = [],
}) {
  const allowedIds = getAllowedSubstationIdsForUser({ profile, substations, mappings })
  if (allowedIds === null) return substations || []
  return (substations || []).filter((item) => allowedIds.includes(toId(item?.id)))
}

export function canAccessSubstationForUser({
  profile,
  substationId,
  substations = [],
  mappings = [],
}) {
  const targetId = toId(substationId)
  if (!targetId) return true
  const allowedIds = getAllowedSubstationIdsForUser({ profile, substations, mappings })
  if (allowedIds === null) return true
  return allowedIds.includes(targetId)
}
