import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Review, ReviewAction } from "@agentgitops/core";
import { CONFIG_DIR } from "@agentgitops/core";

export interface SubmitReviewInput {
  changePackageId: string;
  reviewerId: string;
  action: ReviewAction;
  comment?: string;
}

export class ReviewStore {
  constructor(private readonly projectPath: string) {}

  async list(changePackageId: string): Promise<Review[]> {
    try {
      const content = await fs.readFile(this.pathFor(changePackageId), "utf-8");
      return JSON.parse(content) as Review[];
    } catch {
      return [];
    }
  }

  async submit(input: SubmitReviewInput): Promise<Review> {
    const reviews = await this.list(input.changePackageId);
    const review: Review = {
      id: `review_${randomUUID()}`,
      changePackageId: input.changePackageId,
      reviewerId: input.reviewerId,
      action: input.action,
      comment: input.comment,
      createdAt: new Date().toISOString(),
    };
    reviews.push(review);
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(
      this.pathFor(input.changePackageId),
      JSON.stringify(reviews, null, 2),
      "utf-8",
    );
    return review;
  }

  private get dir(): string {
    return path.join(this.projectPath, CONFIG_DIR, "reviews");
  }

  private pathFor(changePackageId: string): string {
    return path.join(this.dir, `${changePackageId}.json`);
  }
}
