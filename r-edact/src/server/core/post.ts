import { reddit } from "@devvit/web/server";

export const createPost = async () => {
  return await reddit.submitCustomPost({
    title: "r-edact",
  });
};
