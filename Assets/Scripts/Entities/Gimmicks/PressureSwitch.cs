using UnityEngine;
using UnityEngine.Events;

namespace RunToExit.Core
{
    public class PressureSwitch : InteractableBase
    {
        public bool IsOn { get; private set; } = false;
        
        [SerializeField] private float requiredWeight = 1f; 
        
        [Header("Linked Door")]
        public Door targetDoor;

        [Header("Events (Optional)")]
        public UnityEvent OnActivated;
        public UnityEvent OnDeactivated;

        public override bool IsObstacle(CharacterBase character) => false;
        
        public override void OnInteract(CharacterBase character)
        {
            // 上を通過するだけなのでOnInteractは特に使わない（踏み込み判定はUpdateで行う）
        }

        private void Update()
        {
            // 自分自身の上にオブジェクト（キャラクターや木箱）が乗っているか判定
            Collider2D[] hits = Physics2D.OverlapPointAll(new Vector2(GridPosition.x, GridPosition.y));
            bool hasWeight = false;

            foreach (var hit in hits)
            {
                if (hit.GetComponent<CharacterBase>() != null || hit.GetComponent<MovableBox>() != null)
                {
                    hasWeight = true;
                    break;
                }
            }

            if (hasWeight && !IsOn)
            {
                IsOn = true;
                Debug.Log($"{gameObject.name} Activated");
                GetComponent<SpriteRenderer>().color = Color.green; // 仮の見た目変化
                OnActivated?.Invoke();

                if (targetDoor != null && targetDoor.Type == DoorType.Switch)
                {
                    targetDoor.OpenDoor();
                }
            }
            else if (!hasWeight && IsOn)
            {
                IsOn = false;
                Debug.Log($"{gameObject.name} Deactivated");
                GetComponent<SpriteRenderer>().color = Color.red; // 仮の見た目変化
                OnDeactivated?.Invoke();

                if (targetDoor != null && targetDoor.Type == DoorType.Switch)
                {
                    targetDoor.CloseDoor();
                }
            }
        }
    }
}
