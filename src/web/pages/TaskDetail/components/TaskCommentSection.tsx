import { Check, Pencil, Trash2, X } from "lucide-react";

import { MentionTextarea } from "@/web/components/form/MentionTextarea";
import { Textarea } from "@/web/components/form/Textarea";
import { Row, Stack } from "@/web/components/layout";
import { Avatar } from "@/web/components/ui/Avatar";
import { Button } from "@/web/components/ui/Button";
import { HoldToDeleteButton } from "@/web/components/ui/HoldToDeleteButton";
import { IconButton } from "@/web/components/ui/IconButton";
import { MentionText } from "@/web/components/ui/MentionText";
import { CommentSkeletonList } from "@/web/components/ui/Skeleton";
import { Text } from "@/web/components/ui/Text";
import type { Comment } from "@/web/contexts/ProjectContext";
import type { WorkspaceMember } from "@/web/contexts/WorkspaceContext";

interface TaskCommentSectionProps {
  comments: Comment[];
  members: WorkspaceMember[];
  currentUserId: string | undefined;
  commentCount: number;
  // Editing state
  editingCommentId: string | null;
  editingCommentBody: string;
  commentBody: string;
  // Callbacks
  onEditStart: (commentId: string, body: string) => void;
  onEditCancel: () => void;
  onEditSave: (commentId: string) => void | Promise<void>;
  onEditBodyChange: (body: string) => void;
  onDelete: (commentId: string) => void | Promise<void>;
  onCommentBodyChange: (body: string) => void;
  onAddComment: () => void | Promise<void>;
  // Loading / pagination
  isLoading: boolean;
  isError: boolean;
  hasMore: boolean;
  isFetchingMore: boolean;
  onLoadMore: () => void;
  isAddingComment: boolean;
  canEdit: boolean;
  /** "icon" renders a Trash2 IconButton (Dialog), "hold" renders HoldToDeleteButton (Panel) */
  deleteVariant: "icon" | "hold";
}

/**
 * Shared comment section used by both TaskDetailDialog and TaskDetailPanelInner.
 * Renders the comment list with edit/delete actions, pagination, and the
 * comment input area with MentionTextarea.
 */
export function TaskCommentSection({
  comments,
  members,
  currentUserId,
  commentCount,
  editingCommentId,
  editingCommentBody,
  commentBody,
  onEditStart,
  onEditCancel,
  onEditSave,
  onEditBodyChange,
  onDelete,
  onCommentBodyChange,
  onAddComment,
  isLoading,
  isError,
  hasMore,
  isFetchingMore,
  onLoadMore,
  isAddingComment,
  canEdit,
  deleteVariant,
}: TaskCommentSectionProps) {
  return (
    <div>
      <Text variant="body-3" weight="semibold" color="secondary" className="mb-r5">
        Comments ({commentCount})
      </Text>
      {isError && (
        <Text variant="body-2" color="secondary" className="mb-r4">
          Failed to load comments.
        </Text>
      )}
      <Stack gap="r4">
        {isLoading && <CommentSkeletonList />}
        {comments.map((comment) => {
          const author = members.find((m) => m.userId === comment.authorId);
          const isOwn = currentUserId === comment.authorId;
          const isEditing = editingCommentId === comment.id;
          const isOptimistic = comment.id.startsWith("optimistic-");
          return (
            <div
              key={comment.id}
              className={`group rounded-md border border-border-default p-r4${isOptimistic ? " opacity-70" : ""}`}
            >
              <Row gap="r5" align="center" className="mb-r6">
                <Avatar size="xs" name={comment.authorName} src={author?.user.image} />
                <Text variant="body-3" weight="semibold">
                  {comment.authorName}
                </Text>
                <Text variant="body-3" color="muted" className="ml-auto">
                  {new Date(comment.createdAt).toLocaleDateString()}
                  {comment.updatedAt &&
                    new Date(comment.updatedAt).getTime() !==
                      new Date(comment.createdAt).getTime() && (
                      <span
                        className="ml-1 italic"
                        title={`Edited ${new Date(comment.updatedAt).toLocaleDateString()}`}
                      >
                        (edited)
                      </span>
                    )}
                </Text>
                {isOwn && !isEditing && !isOptimistic && (
                  <Row
                    gap="r6"
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <IconButton
                      aria-label="Edit comment"
                      className="p-1"
                      onClick={() => onEditStart(comment.id, comment.body)}
                    >
                      <Pencil size={14} />
                    </IconButton>
                    {deleteVariant === "icon" ? (
                      <IconButton
                        aria-label="Delete comment"
                        className="p-1 text-status-error"
                        onClick={() => void onDelete(comment.id)}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    ) : (
                      <HoldToDeleteButton
                        onDelete={() => void onDelete(comment.id)}
                        label="Hold to delete comment"
                      />
                    )}
                  </Row>
                )}
              </Row>
              {isEditing ? (
                <Stack gap="r6">
                  <Textarea
                    value={editingCommentBody}
                    onChange={(e) => onEditBodyChange(e.target.value)}
                    className="min-h-[2.5rem] border-border-default bg-surface-1 focus:bg-surface-0 text-body-2"
                    autoFocus
                  />
                  <Row gap="r6" className="justify-end">
                    <IconButton
                      aria-label="Cancel editing"
                      className="p-1"
                      onClick={onEditCancel}
                    >
                      <X size={14} />
                    </IconButton>
                    <IconButton
                      aria-label="Save comment"
                      className="p-1 text-status-success"
                      onClick={() => void onEditSave(comment.id)}
                    >
                      <Check size={14} />
                    </IconButton>
                  </Row>
                </Stack>
              ) : (
                <Text variant="body-2">
                  <MentionText>{comment.body}</MentionText>
                </Text>
              )}
            </div>
          );
        })}

        {hasMore && (
          <div className="flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={onLoadMore}
              disabled={isFetchingMore}
            >
              {isFetchingMore ? "Loading..." : "Load more comments"}
            </Button>
          </div>
        )}

        {canEdit && (
          <>
            <MentionTextarea
              value={commentBody}
              onChange={onCommentBodyChange}
              members={members}
              placeholder="Write a comment... Use @ to mention"
              className="min-h-[3.75rem] border-border-default bg-surface-1 focus:bg-surface-0"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => void onAddComment()}
                disabled={!commentBody.trim() || isAddingComment}
              >
                {isAddingComment ? "Sending..." : "Comment"}
              </Button>
            </div>
          </>
        )}
      </Stack>
    </div>
  );
}
