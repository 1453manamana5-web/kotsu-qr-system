import ControlApp from "../../control-app/src/App";

import {
  db,
} from "../firebase";

import "../../control-app/src/index.css";

type ControlPageProps = {
  setPage: (
    page: string
  ) => void;
};

function ControlPage({
  setPage,
}: ControlPageProps) {
  return (
    <ControlApp
      database={db}
      onReturn={() =>
        setPage("admin")
      }
    />
  );
}

export default ControlPage;
