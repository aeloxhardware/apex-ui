import { pushNotification } from "./notificationStore";

export const showSuccess = (message: string) => {
  pushNotification("success", message);
};

export const showError = (message: string) => {
  pushNotification("error", message);
};

export const showWarning = (message: string) => {
  pushNotification("warning", message);
};
