import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

import {
  firebaseApp,
} from "./firebaseApp";

export const db =
  initializeFirestore(
    firebaseApp,
    {
      localCache:
        persistentLocalCache({
          tabManager:
            persistentMultipleTabManager(),
        }),
    }
  );
