import { ClinicalCollaborationDetail } from '@/components/ClinicalCollaborationDetail';

export default function ClinicalCollaborationDetailPage({ params }: { params: { collaboration_id: string } }) {
  return <ClinicalCollaborationDetail collaborationId={params.collaboration_id} />;
}
