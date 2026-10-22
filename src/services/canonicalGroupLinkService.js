import {
  canonicalLinkFields,
  localOnlyFields,
  planCanonicalCreate,
  planCanonicalLink,
} from './canonicalGroupModel.js';

export class CanonicalGroupLinkService {
  constructor(repositories, academicService) {
    this.repositories = repositories;
    this.academicService = academicService;
  }

  async previewExisting(groupId, metadata) {
    const [group, allGroups] = await Promise.all([
      this.repositories.groupInstances.get(groupId),
      this.repositories.groupInstances.list(),
    ]);
    if (!group) throw new Error('CENTRAL_LOCAL_GROUP_NOT_FOUND');
    const [year, subject] = await Promise.all([
      this.repositories.schoolYears.get(group.schoolYearId),
      this.repositories.subjects.get(group.subjectId),
    ]);
    return planCanonicalLink({ group, year, subject, metadata, allGroups });
  }

  async linkExisting(groupId, metadata, expectedUpdatedAt, expectedLocalSnapshot) {
    const plan = await this.previewExisting(groupId, metadata);
    // Required full-row comparison also catches separate writes within one millisecond.
    if (plan.expectedUpdatedAt !== expectedUpdatedAt || !expectedLocalSnapshot ||
        plan.expectedLocalSnapshot !== expectedLocalSnapshot) throw new Error('CENTRAL_LOCAL_STALE_PREVIEW');
    if (!plan.changed) return this.repositories.groupInstances.get(groupId);
    const updated = await this.repositories.groupInstances.update(groupId, canonicalLinkFields(plan.metadata), { expectedSnapshot: expectedLocalSnapshot });
    await this.academicService.audit(plan.mode === 'link' ? 'group-central-linked' : 'group-central-refreshed',
      'groupInstance', groupId, { canonicalGroupId: plan.metadata.groupId, revision: plan.metadata.revision, status: plan.metadata.status });
    return updated;
  }

  async previewCreate(input, metadata) {
    const [year, subject, allGroups] = await Promise.all([
      this.repositories.schoolYears.get(input.schoolYearId),
      this.repositories.subjects.get(input.subjectId),
      this.repositories.groupInstances.list(),
    ]);
    return planCanonicalCreate({ year, subject, metadata, allGroups, displayName: input.displayName });
  }

  async createFromCentral(input, metadata) {
    await this.previewCreate(input, metadata);
    // createGroup writes local group identity + linked instance; never stores members.
    return this.academicService.createGroup({ ...input, canonicalLink: metadata });
  }

  async unlink(groupId, expectedUpdatedAt, expectedLocalSnapshot) {
    const group = await this.repositories.groupInstances.get(groupId);
    if (!group) throw new Error('CENTRAL_LOCAL_GROUP_NOT_FOUND');
    if (group.updatedAt !== expectedUpdatedAt || !expectedLocalSnapshot ||
        JSON.stringify(group) !== expectedLocalSnapshot) throw new Error('CENTRAL_LOCAL_STALE_PREVIEW');
    if (!group.canonicalGroupId) return group;
    const oldId = group.canonicalGroupId;
    const updated = await this.repositories.groupInstances.update(groupId, localOnlyFields(), { expectedSnapshot: expectedLocalSnapshot });
    await this.academicService.audit('group-central-unlinked', 'groupInstance', groupId,
      { previousCanonicalGroupId: oldId });
    return updated;
  }
}
