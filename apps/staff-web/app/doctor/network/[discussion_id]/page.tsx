import {DiscussionThread} from '@/components/DiscussionThread';
export default function DiscussionPage({params}:{params:{discussion_id:string}}){return <DiscussionThread discussionId={params.discussion_id}/>;}
