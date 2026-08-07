using UnityEngine;

namespace RunToExit.Core
{
    public class Door : InteractableBase
    {
        public bool IsOpen { get; private set; } = false;

        public override bool IsObstacle(CharacterBase character) => !IsOpen;

        public override void OnInteract(CharacterBase character)
        {
            // ドア自体はスイッチ等で開くため、触っても何も起きない
        }

        public void OpenDoor()
        {
            IsOpen = true;
            GetComponent<SpriteRenderer>().color = new Color(1, 1, 1, 0.3f); // 半透明にするなど（仮）
            GetComponent<Collider2D>().enabled = false; // 通過可能にする
        }

        public void CloseDoor()
        {
            IsOpen = false;
            GetComponent<SpriteRenderer>().color = new Color(1, 1, 1, 1f); // 元に戻す
            GetComponent<Collider2D>().enabled = true; // 障害物にする
        }
    }
}
